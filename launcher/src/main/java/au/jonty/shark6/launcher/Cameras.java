package au.jonty.shark6.launcher;

import android.content.Context;
import android.provider.Settings;

import java.io.File;
import java.net.InetSocketAddress;
import java.net.Socket;

import dadb.AdbKeyPair;
import dadb.AdbShellResponse;
import dadb.Dadb;

/**
 * Starts the camera helper (libshark6cam.so, built from tools/camhelper) as the shell user.
 * Android only lets the shell user open the car's cameras, so the launcher talks to the car's
 * own ADB on 127.0.0.1:5555. The first time, the car asks to allow debugging from this app.
 */
final class Cameras {
    static final int PORT = 47800;
    private static final String ADB_HOST = "127.0.0.1";
    private static final int ADB_PORT = 5555;

    private Cameras() { }

    /** Starts the helper if it isn't already listening. Returns null when ready, or why it failed. Not on the UI thread. */
    static String start(Context c) {
        if (portOpen(PORT, 200)) return null;
        if (!portOpen(ADB_PORT, 300)) {
            enableAdb(c);
            if (!portOpen(ADB_PORT, 1500)) return "ADB is switched off in the car";
        }
        String lib = c.getApplicationInfo().nativeLibraryDir + "/libshark6cam.so";
        if (!new File(lib).exists()) return "camera helper missing from this build";
        Dadb adb = null;
        try {
            File priv = new File(c.getFilesDir(), "adbkey"), pub = new File(c.getFilesDir(), "adbkey.pub");
            if (!priv.exists() || !pub.exists()) AdbKeyPair.generate(priv, pub);
            adb = Dadb.create(ADB_HOST, ADB_PORT, AdbKeyPair.read(priv, pub), 3000, 30000);
            AdbShellResponse r = adb.shell("cd /data/local/tmp && LD_LIBRARY_PATH=/vendor/lib64:/system/lib64 nohup "
                    + lib + " > /data/local/tmp/shark6cam.log 2>&1 & echo started");
            if (r.getExitCode() != 0) return "helper didn't start: " + r.getAllOutput().trim();
        } catch (Throwable t) {
            return "couldn't reach the car's ADB (allow debugging on the car screen, then try again)";
        } finally {
            if (adb != null) try { adb.close(); } catch (Exception ignored) { }
        }
        for (int i = 0; i < 30; i++) {
            if (portOpen(PORT, 100)) return null;
            try { Thread.sleep(100); } catch (InterruptedException e) { return "interrupted"; }
        }
        return "camera helper didn't come up";
    }

    /** Needs `adb shell pm grant au.jonty.shark6.launcher android.permission.WRITE_SECURE_SETTINGS`. */
    static void enableAdb(Context c) {
        try {
            Settings.Global.putInt(c.getContentResolver(), "adb_enabled", 1);
            Settings.Global.putInt(c.getContentResolver(), "adb_wifi_enabled", 1);
        } catch (Throwable ignored) { }
    }

    static boolean portOpen(int port, int timeoutMs) {
        try (Socket s = new Socket()) {
            s.connect(new InetSocketAddress(ADB_HOST, port), timeoutMs);
            return true;
        } catch (Exception e) {
            return false;
        }
    }
}
