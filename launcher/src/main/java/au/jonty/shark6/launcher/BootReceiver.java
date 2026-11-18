package au.jonty.shark6.launcher;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Opens the home screen when the car's head unit finishes starting (same approach as Sharkware).
 * Android 10+ only lets a background app open a screen if it may draw over other apps, so this
 * needs a one-off: adb shell appops set au.jonty.shark6.launcher SYSTEM_ALERT_WINDOW allow
 */
public class BootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c, Intent i) {
        String a = i.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(a) && !"android.intent.action.QUICKBOOT_POWERON".equals(a)
                && !Intent.ACTION_LOCKED_BOOT_COMPLETED.equals(a)) return;
        Intent open = new Intent(c, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
        try { c.startActivity(open); } catch (Exception ignored) { }
    }
}
