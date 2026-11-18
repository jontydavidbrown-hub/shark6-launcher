package au.jonty.shark6.launcher;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
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

    /** Opening screens from the background needs "draw over apps"; grant it through the car's ADB. */
    static void ensureCanOpen(Context c) {
        if (Settings.canDrawOverlays(c)) return;
        new Thread(() -> Cameras.shell(c, "appops set " + c.getPackageName() + " SYSTEM_ALERT_WINDOW allow"), "grant-overlay").start();
    }

    private final BroadcastReceiver screen = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) {
            if (Intent.ACTION_SCREEN_OFF.equals(i.getAction())) { screenOffAt = SystemClock.elapsedRealtime(); return; }
            boolean wasOff = screenOffAt != 0 && SystemClock.elapsedRealtime() - screenOffAt > CAR_OFF_MS;
            screenOffAt = 0;
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
    }

    @Override public int onStartCommand(Intent i, int flags, int id) { return START_STICKY; }

    @Override public void onDestroy() {
        try { unregisterReceiver(screen); } catch (Exception ignored) { }
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent i) { return null; }
}
