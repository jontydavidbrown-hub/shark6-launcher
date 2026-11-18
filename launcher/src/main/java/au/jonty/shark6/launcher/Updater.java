package au.jonty.shark6.launcher;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInstaller;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Over-the-air updates from the public GitHub releases of this repo.
 * check() looks at the latest release's version.json; install() streams the APK into
 * Android's PackageInstaller, which then asks the driver to confirm (a normal app can't skip that).
 */
final class Updater {
    static final String LATEST = "https://api.github.com/repos/jontydavidbrown-hub/shark6-launcher/releases/latest";
    private static final String ACTION = "au.jonty.shark6.launcher.INSTALL_STATUS";

    interface Progress { void percent(int p); void failed(String why); }

    /** Returns {code, name, url} when a newer build exists, otherwise null. Network thread only. */
    static JSONObject check(Context c) {
        try {
            JSONObject rel = new JSONObject(get(LATEST));
            JSONArray assets = rel.getJSONArray("assets");
            String apk = null, ver = null;
            for (int i = 0; i < assets.length(); i++) {
                JSONObject a = assets.getJSONObject(i);
                String n = a.optString("name");
                if (n.equals("shark6-home.apk")) apk = a.optString("browser_download_url");
                if (n.equals("version.json")) ver = a.optString("browser_download_url");
            }
            if (apk == null || ver == null) return null;
            JSONObject v = new JSONObject(get(ver));
            long mine = c.getPackageManager().getPackageInfo(c.getPackageName(), 0).getLongVersionCode();
            if (v.optLong("code") <= mine) return null;
            return new JSONObject().put("code", v.optLong("code")).put("name", v.optString("name")).put("url", apk);
        } catch (Throwable t) {
            return null; // offline, private repo, rate-limited: just try again next start
        }
    }

    static void install(Context c, String url, Progress p) {
        try {
            HttpURLConnection h = open(url);
            int total = h.getContentLength();
            PackageInstaller pi = c.getPackageManager().getPackageInstaller();
            PackageInstaller.SessionParams sp = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
            sp.setAppPackageName(c.getPackageName());
            int id = pi.createSession(sp);
            try (PackageInstaller.Session s = pi.openSession(id)) {
                try (InputStream in = h.getInputStream(); OutputStream out = s.openWrite("shark6-home.apk", 0, total > 0 ? total : -1)) {
                    byte[] buf = new byte[65536];
                    int n, done = 0, last = -1;
                    while ((n = in.read(buf)) > 0) {
                        out.write(buf, 0, n);
                        done += n;
                        int pct = total > 0 ? (int) (done * 100L / total) : 50;
                        if (pct != last) { p.percent(pct); last = pct; }
                    }
                    s.fsync(out);
                }
                Context app = c.getApplicationContext();
                app.registerReceiver(new BroadcastReceiver() {
                    @Override public void onReceive(Context ctx, Intent i) {
                        int st = i.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
                        if (st == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                            Intent confirm = i.getParcelableExtra(Intent.EXTRA_INTENT);
                            if (confirm != null) { confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); ctx.startActivity(confirm); }
                        } else if (st != PackageInstaller.STATUS_SUCCESS) {
                            p.failed(String.valueOf(i.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)));
                            try { app.unregisterReceiver(this); } catch (Exception ignored) { }
                        }
                    }
                }, new IntentFilter(ACTION));
                Intent cb = new Intent(ACTION).setPackage(c.getPackageName());
                PendingIntent pend = PendingIntent.getBroadcast(c, id, cb, PendingIntent.FLAG_UPDATE_CURRENT
                        | (android.os.Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0));
                s.commit(pend.getIntentSender());
            }
        } catch (Throwable t) {
            p.failed(t.getClass().getSimpleName() + ": " + t.getMessage());
        }
    }

    private static HttpURLConnection open(String url) throws Exception {
        // Follow GitHub's redirect to its download host by hand (keeps working on every Android version).
        for (int i = 0; i < 5; i++) {
            HttpURLConnection h = (HttpURLConnection) new URL(url).openConnection();
            h.setRequestProperty("User-Agent", "shark6-home");
            h.setRequestProperty("Accept", url.contains("api.github.com") ? "application/vnd.github+json" : "*/*");
            h.setConnectTimeout(10000);
            h.setReadTimeout(30000);
            h.setInstanceFollowRedirects(false);
            int code = h.getResponseCode();
            if (code / 100 == 3) { url = h.getHeaderField("Location"); h.disconnect(); continue; }
            if (code != 200) throw new Exception("HTTP " + code);
            return h;
        }
        throw new Exception("too many redirects");
    }

    private static String get(String url) throws Exception {
        HttpURLConnection h = open(url);
        try (InputStream in = h.getInputStream()) {
            ByteArrayOutputStream b = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) b.write(buf, 0, n);
            return b.toString("UTF-8");
        }
    }
}
