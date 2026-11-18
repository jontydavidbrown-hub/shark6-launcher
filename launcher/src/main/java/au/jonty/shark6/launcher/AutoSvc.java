package au.jonty.shark6.launcher;

import android.content.Context;
import android.os.IBinder;
import android.os.Parcel;

import java.io.File;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import dadb.AdbKeyPair;
import dadb.AdbShellPacket;
import dadb.AdbShellStream;
import dadb.Dadb;

/**
 * Reads the indicators through BYD's "autoservice" (DiLink 5 typed read: transaction 5, device,
 * feature; reply = status, value). The SDK's light getters don't answer on the Shark. Feature IDs
 * from Overdrive (MIT): light device 1004, turn-signal flash state 950009900 (2/3 left, 4/5 right,
 * 6/7 hazards). Tries the binder directly; if the app may not reach it, polls through the car's
 * own ADB shell instead.
 */
final class AutoSvc {
    static final int DEV_LIGHT = 1004, FID_TURN = 950009900;
    private static final Pattern WORD = Pattern.compile("\\b([0-9a-fA-F]{8})\\b");

    private final Context ctx;
    private IBinder binder;
    private String token;
    private boolean binderTried;
    private volatile int shellTurn = -1;
    private volatile long shellAt;
    private Thread shellThread;
    private volatile boolean shellWanted;
    volatile String source = "none";
    volatile String last = "";

    AutoSvc(Context c) { ctx = c.getApplicationContext(); }

    /** Indicator state 0 off, 1 left, 2 right, 3 hazards; -1 when unknown. */
    int turn() {
        int raw = readInt(DEV_LIGHT, FID_TURN);
        if (raw == Integer.MIN_VALUE) {
            ensureShell();
            raw = System.currentTimeMillis() - shellAt < 1500 ? shellTurn : Integer.MIN_VALUE;
        }
        if (raw == Integer.MIN_VALUE) return -1;
        if (raw == 2 || raw == 3) return 1;
        if (raw == 4 || raw == 5) return 2;
        if (raw == 6 || raw == 7) return 3;
        return 0;
    }

    void stop() { shellWanted = false; Thread t = shellThread; if (t != null) t.interrupt(); }

    private synchronized int readInt(int device, int feature) {
        if (!binderTried) {
            binderTried = true;
            try {
                Class<?> sm = Class.forName("android.os.ServiceManager");
                binder = (IBinder) sm.getMethod("getService", String.class).invoke(null, "autoservice");
                token = binder == null ? null : binder.getInterfaceDescriptor();
                source = binder == null ? "binder: not found" : "binder: " + token;
            } catch (Throwable t) {
                binder = null;
                source = "binder: " + t.getClass().getSimpleName();
            }
        }
        if (binder == null || token == null || token.isEmpty()) return Integer.MIN_VALUE;
        Parcel data = Parcel.obtain(), reply = Parcel.obtain();
        try {
            data.writeInterfaceToken(token);
            data.writeInt(device);
            data.writeInt(feature);
            if (!binder.transact(5, data, reply, 0) || reply.dataAvail() < 8) return Integer.MIN_VALUE;
            int status = reply.readInt(), value = reply.readInt();
            last = "binder " + status + "/" + value;
            return status == 0 && value >= 0 && value <= 7 ? value : Integer.MIN_VALUE;
        } catch (Throwable t) {
            source = "binder failed: " + t.getClass().getSimpleName();
            binder = null;
            return Integer.MIN_VALUE;
        } finally {
            data.recycle();
            reply.recycle();
        }
    }

    /** Fallback: one long-running shell loop on the car's ADB printing the turn state 4x a second. */
    private synchronized void ensureShell() {
        shellWanted = true;
        if (shellThread != null && shellThread.isAlive()) return;
        shellThread = new Thread(this::shellLoop, "turn-shell");
        shellThread.start();
    }

    private void shellLoop() {
        while (shellWanted) {
            source = "shell: connecting";
            if (!Cameras.portOpen(5555, 300)) { Cameras.enableAdb(ctx); }
            try {
                File priv = new File(ctx.getFilesDir(), "adbkey"), pub = new File(ctx.getFilesDir(), "adbkey.pub");
                if (!priv.exists() || !pub.exists()) AdbKeyPair.generate(priv, pub);
                try (Dadb adb = Dadb.create("127.0.0.1", 5555, AdbKeyPair.read(priv, pub), 3000, 0);
                     AdbShellStream sh = adb.openShell("while :; do service call autoservice 5 i32 " + DEV_LIGHT
                             + " i32 " + FID_TURN + "; sleep 0.25; done")) {
                    source = "shell";
                    StringBuilder line = new StringBuilder();
                    while (shellWanted) {
                        AdbShellPacket p = sh.read();
                        if (p instanceof AdbShellPacket.Exit) break;
                        if (!(p instanceof AdbShellPacket.StdOut)) continue;
                        for (byte b : p.getPayload()) {
                            if (b != '\n') { line.append((char) b); continue; }
                            parse(line.toString());
                            line.setLength(0);
                        }
                    }
                }
            } catch (Throwable t) {
                source = "shell failed: " + t.getClass().getSimpleName();
            }
            try { Thread.sleep(3000); } catch (InterruptedException e) { return; }
        }
    }

    private void parse(String s) {
        if (!s.contains("Parcel")) return;
        Matcher m = WORD.matcher(s.substring(s.indexOf("Parcel")));
        long[] w = new long[2];
        int n = 0;
        while (n < 2 && m.find()) w[n++] = Long.parseLong(m.group(1), 16);
        if (n < 2) return;
        last = "shell " + (int) w[0] + "/" + (int) w[1];
        if (w[0] == 0 && w[1] >= 0 && w[1] <= 7) { shellTurn = (int) w[1]; shellAt = System.currentTimeMillis(); }
    }
}
