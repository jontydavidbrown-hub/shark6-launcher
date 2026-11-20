package au.jonty.shark6.launcher;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * "Send to Claude": posts the diagnostics and the car probe as an issue on the launcher's GitHub
 * repo, where Claude reads it. The GitHub key is typed in once on the phone page (port 8686) and
 * kept only on the car; it is never part of the app itself.
 */
final class Report {
    static final String REPO = "jontydavidbrown-hub/shark6-launcher";
    private static final int MAX = 60000;

    private Report() { }

    private static SharedPreferences prefs(Context c) { return c.getSharedPreferences("report", Context.MODE_PRIVATE); }

    static boolean hasKey(Context c) { return !prefs(c).getString("gh", "").isEmpty(); }

    /** Checks the key can see the repo, then saves it. Returns a message for the phone page. */
    static String saveKey(Context c, String key) {
        key = key == null ? "" : key.trim();
        if (key.isEmpty()) return "Paste the GitHub key first.";
        try {
            HttpURLConnection h = open("https://api.github.com/repos/" + REPO, key);
            int code = h.getResponseCode();
            h.disconnect();
            if (code == 401) return "GitHub says that key isn't valid. Check you copied all of it.";
            if (code != 200) return "GitHub said " + code + " for that key. Make sure it can access " + REPO + ".";
        } catch (Exception e) {
            return "Couldn't reach GitHub from the car: " + e.getMessage();
        }
        prefs(c).edit().putString("gh", key).apply();
        return "Saved. Now hold the clock on the car for 2 seconds and tap SEND TO CLAUDE.";
    }

    /** Builds the report (diagnostics + probe) and posts it. Returns a short message for the screen. */
    static String send(Context c, String diag, String probe) {
        String key = prefs(c).getString("gh", "");
        if (key.isEmpty()) return "Needs the GitHub key first: open the phone page and add it under Claude link.";
        String ver = "?";
        try { ver = c.getPackageManager().getPackageInfo(c.getPackageName(), 0).versionName; } catch (Exception ignored) { }
        String when = new SimpleDateFormat("d MMM HH:mm", Locale.ROOT).format(new Date());
        String d = diag == null ? "" : diag.replaceAll("(?m)^SIDELOAD\\|([^|\\n]*)\\|\\d+", "SIDELOAD|$1|----");
        String p = probe == null ? "(probe unavailable: couldn't reach the car's ADB)" : probe;
        String head = "Sent from Shark 6 Home " + ver + " on the car.\n\n## Diagnostics\n```\n" + d + "\n```\n\n## Probe\n```\n";
        int room = MAX - head.length() - 40;
        if (p.length() > room) p = p.substring(0, Math.max(0, room)) + "\n…(cut)";
        String body = head + p.replace("```", "'''") + "\n```\n";
        try {
            JSONObject j = new JSONObject();
            j.put("title", "Car report " + ver + " · " + when);
            j.put("body", body);
            HttpURLConnection h = open("https://api.github.com/repos/" + REPO + "/issues", key);
            h.setRequestMethod("POST");
            h.setDoOutput(true);
            h.setRequestProperty("Content-Type", "application/json");
            try (OutputStream o = h.getOutputStream()) { o.write(j.toString().getBytes("UTF-8")); }
            int code = h.getResponseCode();
            String resp = read(code < 400 ? h.getInputStream() : h.getErrorStream());
            h.disconnect();
            if (code == 201) {
                int n = new JSONObject(resp).optInt("number");
                return "Sent to Claude (report #" + n + "). Tell Claude in chat.";
            }
            if (code == 401) return "GitHub rejected the key. Add a new one on the phone page.";
            if (code == 403 || code == 404) return "The key can't create issues. It needs Issues: read and write on " + REPO + ".";
            return "GitHub said " + code + ". Try again.";
        } catch (Exception e) {
            return "Couldn't send: " + e.getMessage() + ". Is the car online?";
        }
    }

    private static HttpURLConnection open(String url, String key) throws Exception {
        HttpURLConnection h = (HttpURLConnection) new URL(url).openConnection();
        h.setConnectTimeout(15000);
        h.setReadTimeout(30000);
        h.setRequestProperty("Authorization", "Bearer " + key);
        h.setRequestProperty("Accept", "application/vnd.github+json");
        h.setRequestProperty("User-Agent", "shark6-home");
        return h;
    }

    private static String read(InputStream in) throws Exception {
        if (in == null) return "";
        try (InputStream i = in) {
            java.io.ByteArrayOutputStream b = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            for (int n; (n = i.read(buf)) > 0; ) b.write(buf, 0, n);
            return b.toString("UTF-8");
        }
    }
}
