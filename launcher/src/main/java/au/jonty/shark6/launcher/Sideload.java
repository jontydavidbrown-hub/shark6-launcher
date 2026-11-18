package au.jonty.shark6.launcher;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.os.Handler;
import android.os.Looper;
import android.widget.Toast;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.net.URLDecoder;
import java.util.Collections;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Random;

import dadb.AdbKeyPair;
import dadb.Dadb;

/**
 * App installer over Wi-Fi. A small web page on port 8686 lets a phone on the same network
 * upload an APK (or give a link to one). The car installs it through its own ADB, so there is
 * no confirmation prompt, then opens it. A 4-digit PIN shown on the car guards the page.
 */
final class Sideload {
    static final int PORT = 8686;
    private static final long MAX_APK = 1500L * 1024 * 1024;
    static final String PIN = String.format(Locale.ROOT, "%04d", new Random().nextInt(10000));
    private static volatile boolean started;
    static volatile String last = "nothing yet";

    static void start(Context c) {
        if (started) return;
        started = true;
        Context app = c.getApplicationContext();
        Thread t = new Thread(() -> {
            try (ServerSocket ss = new ServerSocket(PORT)) {
                while (true) {
                    Socket s = ss.accept();
                    new Thread(() -> handle(app, s), "sideload-conn").start();
                }
            } catch (Throwable e) {
                started = false;
                last = "server stopped: " + e.getMessage();
            }
        }, "sideload");
        t.setDaemon(true);
        t.start();
    }

    /**
     * Where a phone can reach the page. The car also has internal networks (172.16.x for its own
     * modules) that a phone can never reach, so those are left out. 192.168.43.1 is the car's own
     * hotspot; any other private address is a Wi-Fi network the car has joined.
     */
    static String address() {
        StringBuilder b = new StringBuilder();
        String hotspot = null;
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                String name = ni.getName() == null ? "" : ni.getName();
                if (!(name.startsWith("wlan") || name.startsWith("ap") || name.startsWith("swlan") || name.startsWith("softap"))) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    if (!(a instanceof Inet4Address) || a.isLoopbackAddress()) continue;
                    String ip = a.getHostAddress();
                    if (ip.startsWith("172.16.")) continue;
                    String url = "http://" + ip + ":" + PORT;
                    if (ip.startsWith("192.168.43.")) { hotspot = url; continue; }
                    if (b.length() > 0) b.append("  or  ");
                    b.append(url).append(" (Wi-Fi)");
                }
            }
        } catch (Exception ignored) { }
        if (hotspot != null) {
            if (b.length() > 0) b.append("  or  ");
            b.append(hotspot).append(" (join the car's hotspot)");
        }
        return b.length() == 0 ? "connect the car to Wi-Fi or turn on its hotspot" : b.toString();
    }

    private static void handle(Context c, Socket s) {
        try (Socket sock = s) {
            sock.setSoTimeout(60000);
            InputStream in = new BufferedInputStream(sock.getInputStream());
            OutputStream out = sock.getOutputStream();
            String line = readLine(in);
            if (line == null) return;
            String[] parts = line.split(" ");
            if (parts.length < 2) return;
            String method = parts[0], target = parts[1];
            Map<String, String> h = new HashMap<>();
            for (String l; (l = readLine(in)) != null && !l.isEmpty(); ) {
                int i = l.indexOf(':');
                if (i > 0) h.put(l.substring(0, i).trim().toLowerCase(Locale.ROOT), l.substring(i + 1).trim());
            }
            String path = target, query = "";
            int q = target.indexOf('?');
            if (q >= 0) { path = target.substring(0, q); query = target.substring(q + 1); }
            Map<String, String> qp = params(query);

            if (method.equals("GET") && path.equals("/")) { reply(out, 200, "text/html; charset=utf-8", PAGE); return; }
            if (!PIN.equals(qp.get("pin"))) { reply(out, 403, "text/plain", "Wrong PIN. Check the PIN on the car screen."); return; }

            File dir = new File(c.getCacheDir(), "sideload");
            dir.mkdirs();
            File apk = new File(dir, "incoming.apk");
            if (method.equals("POST") && path.equals("/upload")) {
                long len = Long.parseLong(h.getOrDefault("content-length", "-1"));
                if (len <= 0 || len > MAX_APK) { reply(out, 400, "text/plain", "No file, or file too big."); return; }
                toast(c, "Receiving app…");
                try (OutputStream f = new FileOutputStream(apk)) { copy(in, f, len); }
            } else if (method.equals("POST") && path.equals("/url")) {
                String u = qp.get("u");
                if (u == null || !u.startsWith("http")) { reply(out, 400, "text/plain", "That doesn't look like a link."); return; }
                toast(c, "Downloading app…");
                download(u, apk);
            } else {
                reply(out, 404, "text/plain", "Not found");
                return;
            }
            String result = install(c, apk);
            apk.delete();
            last = result;
            reply(out, result.startsWith("Installed") ? 200 : 500, "text/plain; charset=utf-8", result);
        } catch (Throwable t) {
            last = "failed: " + t.getMessage();
            toast(c, "App install failed");
        }
    }

    /** Installs through the car's ADB (no prompt), then opens the app. Returns a short message. */
    static String install(Context c, File apk) {
        PackageInfo info = c.getPackageManager().getPackageArchiveInfo(apk.getPath(), 0);
        if (info == null) { toast(c, "That file isn't an Android app"); return "That file isn't an Android app (APK)."; }
        String pkg = info.packageName;
        CharSequence label = pkg;
        try {
            info.applicationInfo.sourceDir = apk.getPath();
            info.applicationInfo.publicSourceDir = apk.getPath();
            label = info.applicationInfo.loadLabel(c.getPackageManager());
        } catch (Throwable ignored) { }
        if (pkg.equals(c.getPackageName())) return "Use the launcher's own update button for Shark 6 Home.";
        toast(c, "Installing " + label + "…");
        String err = null;
        if (!Cameras.portOpen(5555, 300)) Cameras.enableAdb(c);
        try {
            File priv = new File(c.getFilesDir(), "adbkey"), pub = new File(c.getFilesDir(), "adbkey.pub");
            if (!priv.exists() || !pub.exists()) AdbKeyPair.generate(priv, pub);
            try (Dadb adb = Dadb.create("127.0.0.1", 5555, AdbKeyPair.read(priv, pub), 5000, 120000)) {
                adb.install(apk, "-r", "-g");
            }
        } catch (Throwable t) {
            err = t.getMessage() == null ? t.getClass().getSimpleName() : t.getMessage();
        }
        if (err != null) {
            toast(c, "Couldn't install " + label);
            return "Couldn't install " + label + ": " + err;
        }
        toast(c, "Installed " + label);
        Intent open = c.getPackageManager().getLaunchIntentForPackage(pkg);
        if (open != null) {
            open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            new Handler(Looper.getMainLooper()).post(() -> { try { c.startActivity(open); } catch (Exception ignored) { } });
        }
        return "Installed " + label + (open != null ? ". Opening it on the car now." : ".");
    }

    private static void download(String url, File to) throws Exception {
        for (int i = 0; i < 6; i++) {
            HttpURLConnection h = (HttpURLConnection) new URL(url).openConnection();
            h.setRequestProperty("User-Agent", "shark6-home");
            h.setConnectTimeout(15000);
            h.setReadTimeout(60000);
            h.setInstanceFollowRedirects(false);
            int code = h.getResponseCode();
            if (code / 100 == 3) { url = new URL(new URL(url), h.getHeaderField("Location")).toString(); h.disconnect(); continue; }
            if (code != 200) throw new Exception("download failed (HTTP " + code + ")");
            try (InputStream in = h.getInputStream(); OutputStream f = new FileOutputStream(to)) { copy(in, f, MAX_APK); }
            return;
        }
        throw new Exception("too many redirects");
    }

    private static void copy(InputStream in, OutputStream out, long max) throws Exception {
        byte[] buf = new byte[65536];
        long left = max;
        int n;
        while (left > 0 && (n = in.read(buf, 0, (int) Math.min(buf.length, left))) > 0) { out.write(buf, 0, n); left -= n; }
    }

    private static String readLine(InputStream in) throws Exception {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        int ch;
        while ((ch = in.read()) != -1) {
            if (ch == '\n') break;
            if (ch != '\r') b.write(ch);
            if (b.size() > 8192) return null;
        }
        return ch == -1 && b.size() == 0 ? null : b.toString("UTF-8");
    }

    private static Map<String, String> params(String q) {
        Map<String, String> m = new HashMap<>();
        for (String kv : q.split("&")) {
            int i = kv.indexOf('=');
            if (i <= 0) continue;
            try { m.put(kv.substring(0, i), URLDecoder.decode(kv.substring(i + 1), "UTF-8")); } catch (Exception ignored) { }
        }
        return m;
    }

    private static void reply(OutputStream out, int code, String type, String body) throws Exception {
        byte[] b = body.getBytes("UTF-8");
        String head = "HTTP/1.1 " + code + " OK\r\nContent-Type: " + type + "\r\nContent-Length: " + b.length
                + "\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n";
        out.write(head.getBytes("UTF-8"));
        out.write(b);
        out.flush();
    }

    private static void toast(Context c, String m) {
        new Handler(Looper.getMainLooper()).post(() -> Toast.makeText(c, m, Toast.LENGTH_LONG).show());
    }

    private static final String PAGE = "<!doctype html><html><head><meta charset=utf-8>"
            + "<meta name=viewport content='width=device-width,initial-scale=1'><title>Send to Shark 6</title>"
            + "<style>body{margin:0;background:#050505;color:#F2F2F2;font:16px system-ui,sans-serif;padding:24px 16px}"
            + "h1{font-size:22px;margin:0 0 4px;color:#D42A3A}p{color:#A6A6A6;margin:0 0 20px}"
            + "label{display:block;font-size:13px;color:#A6A6A6;margin:16px 0 6px;text-transform:uppercase;letter-spacing:.06em}"
            + "input{width:100%;box-sizing:border-box;background:#111;border:1px solid #333;color:#F2F2F2;border-radius:8px;padding:12px;font-size:16px}"
            + "button{width:100%;margin-top:12px;background:#D42A3A;color:#fff;border:0;border-radius:8px;padding:14px;font-size:16px;font-weight:600}"
            + "button:disabled{opacity:.5}#s{margin-top:20px;white-space:pre-wrap;color:#F2F2F2}</style></head><body>"
            + "<h1>Send an app to the Shark</h1><p>Pick an APK file or paste a link to one. The car installs it and opens it.</p>"
            + "<label>PIN on the car screen</label><input id=pin inputmode=numeric maxlength=4 placeholder='0000'>"
            + "<label>APK file</label><input id=f type=file accept='.apk,application/vnd.android.package-archive'>"
            + "<button id=up>Send file</button>"
            + "<label>Or a link to an APK</label><input id=u type=url placeholder='https://…/game.apk'>"
            + "<button id=go>Send link</button><div id=s></div><script>"
            + "const $=i=>document.getElementById(i),say=t=>$('s').textContent=t;"
            + "try{$('pin').value=localStorage.pin||''}catch(e){}"
            + "function pin(){const p=$('pin').value.trim();try{localStorage.pin=p}catch(e){}return encodeURIComponent(p)}"
            + "function busy(b){$('up').disabled=$('go').disabled=b}"
            + "$('up').onclick=()=>{const f=$('f').files[0];if(!f)return say('Pick an APK first.');busy(true);"
            + "const x=new XMLHttpRequest();x.open('POST','/upload?pin='+pin());"
            + "x.upload.onprogress=e=>{if(e.lengthComputable)say('Sending… '+Math.round(e.loaded*100/e.total)+'%'+(e.loaded==e.total?'\\nInstalling…':''))};"
            + "x.onload=()=>{busy(false);say(x.responseText)};x.onerror=()=>{busy(false);say('Lost the connection to the car.')};x.send(f)};"
            + "$('go').onclick=async()=>{const u=$('u').value.trim();if(!u)return say('Paste a link first.');busy(true);say('The car is downloading and installing…');"
            + "try{const r=await fetch('/url?pin='+pin()+'&u='+encodeURIComponent(u),{method:'POST'});say(await r.text())}catch(e){say('Lost the connection to the car.')}busy(false)};"
            + "</script></body></html>";
}
