package au.jonty.shark6.launcher;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.os.IBinder;
import android.os.SystemClock;
import android.provider.Settings;

/**
 * Brings the home screen up when the car starts. The head unit mostly sleeps rather than reboots
 * when the car is switched off, so "boot completed" alone often never arrives. This small
 * foreground service stays alive through that sleep and opens the home screen when the screen
 * comes back on after being off for a while (a car start, not a brief blank). It also makes sure
 * the app may open screens from the background, using the car's own ADB if that wasn't set up.
 */
public class Wake extends Service {
    private static final long CAR_OFF_MS = 60_000;
    private long screenOffAt;

    static void start(Context c) {
        try { c.startForegroundService(new Intent(c, Wake.class)); } catch (Exception ignored) { }
    }

    static void openHome(Context c) {
        Intent open = new Intent(c, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
        try { c.startActivity(open); } catch (Exception ignored) { }
    }

    /**
     * Opening screens from the background needs "draw over apps", and BYD's motor and instrument
     * readings need their permissions granted (power/regen, trip reset). Grant whatever is missing
     * through the car's own ADB, in one shell call.
     */
    static void ensureCanOpen(Context c) {
        StringBuilder cmd = new StringBuilder();
        String pkg = c.getPackageName();
        if (!Settings.canDrawOverlays(c)) cmd.append("appops set ").append(pkg).append(" SYSTEM_ALERT_WINDOW allow;");
        try {
            String[] req = c.getPackageManager().getPackageInfo(pkg, PackageManager.GET_PERMISSIONS).requestedPermissions;
            if (req != null) for (String p : req) {
                if ((p.startsWith("android.permission.BYDAUTO_") || p.endsWith("_LOCATION"))
                        && c.checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) {
                    cmd.append("pm grant ").append(pkg).append(' ').append(p).append(" 2>/dev/null;");
                }
            }
        } catch (Exception ignored) { }
        // Now playing reads other apps' media sessions, which needs notification access.
        try {
            android.content.ComponentName ml = new android.content.ComponentName(c, MediaListener.class);
            NotificationManager nm = c.getSystemService(NotificationManager.class);
            if (!nm.isNotificationListenerAccessGranted(ml)) {
                cmd.append("cmd notification allow_listener ").append(ml.flattenToString()).append(';');
            }
        } catch (Exception ignored) { }
        // Be the car's home screen, so every start (sleep or reboot) and the Home button land here.
        try {
            Intent home = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME);
            android.content.pm.ResolveInfo r = c.getPackageManager().resolveActivity(home, PackageManager.MATCH_DEFAULT_ONLY);
            if (r == null || r.activityInfo == null || !pkg.equals(r.activityInfo.packageName)) {
                cmd.append("pm set-home-activity ").append(pkg).append('/').append(MainActivity.class.getName()).append(" 2>&1;");
            }
        } catch (Exception ignored) { }
        if (cmd.length() == 0) return;
        new Thread(() -> {
            Cameras.shell(c, cmd.toString());
            CarData.permissionsChanged = true;
        }, "grant-perms").start();
    }

    private final BroadcastReceiver screen = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) {
            if (Intent.ACTION_SCREEN_OFF.equals(i.getAction())) { screenOffAt = SystemClock.elapsedRealtime(); return; }
            boolean wasOff = screenOffAt != 0 && SystemClock.elapsedRealtime() - screenOffAt > CAR_OFF_MS;
            screenOffAt = 0;
            if (wasOff) lastWake = "screen back on";
            if (wasOff && !MainActivity.isShowing()) openHome(c);
        }
    };

    @Override public void onCreate() {
        super.onCreate();
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel("wake", "Start with the car", NotificationManager.IMPORTANCE_MIN));
        Notification n = new Notification.Builder(this, "wake")
                .setSmallIcon(R.mipmap.ic_launcher).setContentTitle("Shark 6 Home").setOngoing(true).build();
        startForeground(1, n);
        IntentFilter f = new IntentFilter(Intent.ACTION_SCREEN_ON);
        f.addAction(Intent.ACTION_SCREEN_OFF);
        registerReceiver(screen, f);
        ensureCanOpen(this);
        Sideload.start(this);
        startSleepWatch();
    }

    /**
     * The head unit may sleep without sending screen on/off. While asleep, elapsedRealtime keeps
     * counting but uptimeMillis stops, so a gap between the two after a short tick means the unit
     * was suspended: treat a gap over a minute as a car start and bring the home screen up.
     */
    private volatile boolean watching;
    private void startSleepWatch() {
        if (watching) return;
        watching = true;
        Thread t = new Thread(() -> {
            long er = SystemClock.elapsedRealtime(), up = SystemClock.uptimeMillis();
            while (watching) {
                try { Thread.sleep(2000); } catch (InterruptedException e) { return; }
                long er2 = SystemClock.elapsedRealtime(), up2 = SystemClock.uptimeMillis();
                long slept = (er2 - er) - (up2 - up);
                er = er2; up = up2;
                if (slept > CAR_OFF_MS) {
                    lastWake = "woke after " + (slept / 1000) + " s asleep";
                    if (!MainActivity.isShowing()) openHome(this);
                }
            }
        }, "sleep-watch");
        t.setDaemon(true);
        t.start();
    }

    static volatile String lastWake = "no sleep seen yet";

    @Override public int onStartCommand(Intent i, int flags, int id) { return START_STICKY; }

    @Override public void onDestroy() {
        watching = false;
        try { unregisterReceiver(screen); } catch (Exception ignored) { }
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent i) { return null; }
}
