package au.jonty.shark6.launcher;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Opens the home screen when the head unit finishes starting, and starts the Wake service that
 * reopens it on later car starts (the unit usually sleeps instead of rebooting). After an update
 * it restarts that service and comes back to the home screen.
 */
public class BootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c, Intent i) {
        String a = i.getAction();
        boolean boot = Intent.ACTION_BOOT_COMPLETED.equals(a) || "android.intent.action.QUICKBOOT_POWERON".equals(a)
                || Intent.ACTION_LOCKED_BOOT_COMPLETED.equals(a);
        boolean updated = Intent.ACTION_MY_PACKAGE_REPLACED.equals(a);
        if (!boot && !updated) return;
        Wake.start(c);
        Wake.openHome(c);
    }
}
