package au.jonty.shark6.launcher;

import android.content.Context;
import android.provider.Settings;

import java.io.File;
import java.net.InetSocketAddress;
import java.net.Socket;

import dadb.AdbKeyPair;
import dadb.AdbShellStream;
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

    /** A running helper. Closing it ends the ADB session, which stops the helper and frees the cameras. */
    static final class Session implements AutoCloseable {
        private final Dadb adb;
        private final AdbShellStream shell;
        Session(Dadb adb, AdbShellStream shell) { this.adb = adb; this.shell = shell; }
        @Override public void close() {
            try { if (shell != null) shell.close(); } catch (Exception ignored) { }
            try { if (adb != null) adb.close(); } catch (Exception ignored) { }
        }
    }

    /**
     * Starts the helper and keeps its ADB session open (the car kills it the moment the session
     * closes). Returns the session once the helper is listening, or null if one is already running
     * (started by hand). Throws with a readable reason. Not on the UI thread.
     */
    static Session start(Context c) throws Exception {
        if (portOpen(PORT, 200)) return null;
        if (!portOpen(ADB_PORT, 300)) {
            enableAdb(c);
            if (!portOpen(ADB_PORT, 1500)) throw new Exception("ADB is switched off in the car");
        }
        String lib = c.getApplicationInfo().nativeLibraryDir + "/libshark6cam.so";
        if (!new File(lib).exists()) throw new Exception("camera helper missing from this build");
        Dadb adb = null;
        AdbShellStream shell = null;
        try {
            File priv = new File(c.getFilesDir(), "adbkey"), pub = new File(c.getFilesDir(), "adbkey.pub");
            if (!priv.exists() || !pub.exists()) AdbKeyPair.generate(priv, pub);
            adb = Dadb.create(ADB_HOST, ADB_PORT, AdbKeyPair.read(priv, pub), 3000, 0);
            shell = adb.openShell("cd /data/local/tmp && LD_LIBRARY_PATH=/vendor/lib64:/system/lib64 exec "
                    + lib + " 2> /data/local/tmp/shark6cam.log");
        } catch (Throwable t) {
            new Session(adb, shell).close();
            throw new Exception("couldn't use the car's ADB: " + t.getClass().getSimpleName()
                    + (t.getMessage() == null ? "" : " " + t.getMessage()));
        }
        Session session = new Session(adb, shell);
        for (int i = 0; i < 40; i++) {
            if (portOpen(PORT, 100)) return session;
            Thread.sleep(100);
        }
        session.close();
        throw new Exception("camera helper didn't come up (log: /data/local/tmp/shark6cam.log)");
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
