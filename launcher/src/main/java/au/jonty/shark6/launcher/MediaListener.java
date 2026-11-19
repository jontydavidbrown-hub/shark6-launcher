package au.jonty.shark6.launcher;

import android.app.Notification;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

/**
 * Being an allowed listener is what lets us read media sessions. It also keeps the latest
 * "now playing"-style notification, for players (like the car's CarPlay app) that show the
 * track in a notification without publishing a media session.
 */
public class MediaListener extends NotificationListenerService {
    static volatile String[] lastMedia;   // {package, title, text}
    static volatile String seen = "";

    @Override public void onListenerConnected() {
        try { for (StatusBarNotification n : getActiveNotifications()) consider(n); } catch (Exception ignored) { }
    }

    @Override public void onNotificationPosted(StatusBarNotification sbn) { consider(sbn); }

    @Override public void onNotificationRemoved(StatusBarNotification sbn) {
        String[] m = lastMedia;
        if (m != null && m[0].equals(sbn.getPackageName())) lastMedia = null;
    }

    private void consider(StatusBarNotification sbn) {
        try {
            Notification n = sbn.getNotification();
            Bundle e = n.extras;
            String pkg = sbn.getPackageName();
            if (!seen.contains(pkg)) seen = (seen + " " + pkg).trim();
            boolean media = e.containsKey(Notification.EXTRA_MEDIA_SESSION)
                    || Notification.CATEGORY_TRANSPORT.equals(n.category)
                    || "android.app.Notification$MediaStyle".equals(e.getString(Notification.EXTRA_TEMPLATE))
                    || pkg.toLowerCase().contains("carplay");
            if (!media) return;
            CharSequence title = e.getCharSequence(Notification.EXTRA_TITLE);
            CharSequence text = e.getCharSequence(Notification.EXTRA_TEXT);
            if (title == null || title.length() == 0) return;
            lastMedia = new String[]{pkg, title.toString(), text == null ? "" : text.toString()};
        } catch (Exception ignored) { }
    }
}
