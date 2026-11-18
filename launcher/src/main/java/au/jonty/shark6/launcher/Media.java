package au.jonty.shark6.launcher;

import android.content.ComponentName;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.os.SystemClock;
import android.util.Base64;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.util.List;

/** What's playing (CarPlay, Spotify, BYD radio…) via media sessions. Needs the listener allowed with adb. */
final class Media {
    private final Context ctx;
    private final ComponentName listener;
    private MediaController current;
    private String artKey;
    private String artData;

    Media(Context ctx) {
        this.ctx = ctx.getApplicationContext();
        this.listener = new ComponentName(ctx, MediaListener.class);
    }

    private MediaController pick() {
        try {
            MediaSessionManager msm = (MediaSessionManager) ctx.getSystemService(Context.MEDIA_SESSION_SERVICE);
            List<MediaController> list = msm.getActiveSessions(listener);
            MediaController best = null;
            for (MediaController c : list) {
                PlaybackState s = c.getPlaybackState();
                if (s != null && s.getState() == PlaybackState.STATE_PLAYING) return c;
                if (best == null && c.getMetadata() != null) best = c;
            }
            return best;
        } catch (SecurityException e) {
            return null; // listener not allowed yet
        }
    }

    JSONObject read() {
        JSONObject o = new JSONObject();
        current = pick();
        if (current == null) return o;
        try {
            MediaMetadata md = current.getMetadata();
            PlaybackState ps = current.getPlaybackState();
            if (md != null) {
                String title = md.getString(MediaMetadata.METADATA_KEY_TITLE);
                if (title == null) title = md.getString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE);
                String artist = md.getString(MediaMetadata.METADATA_KEY_ARTIST);
                if (artist == null) artist = md.getString(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE);
                if (title != null && !title.equals("null") && !title.equals("?")) o.put("title", title);
                if (artist != null && !artist.equals("null") && !artist.equals("?")) o.put("artist", artist);
                o.put("dur", md.getLong(MediaMetadata.METADATA_KEY_DURATION));
                String art = art(md, title);
                if (art != null) o.put("art", art);
            }
            String app = appName(current.getPackageName());
            o.put("app", app);
            // Some sources (BYD radio, local music) publish a session with no track title: show the app.
            if (!o.has("title")) o.put("title", app);
            if (ps != null) {
                boolean playing = ps.getState() == PlaybackState.STATE_PLAYING;
                o.put("playing", playing);
                long pos = ps.getPosition();
                if (playing && ps.getLastPositionUpdateTime() > 0) {
                    pos += (long) ((SystemClock.elapsedRealtime() - ps.getLastPositionUpdateTime()) * ps.getPlaybackSpeed());
                }
                o.put("pos", Math.max(0, pos));
            }
        } catch (Exception ignored) { }
        return o;
    }

    private String art(MediaMetadata md, String title) {
        String key = current.getPackageName() + "|" + title;
        if (key.equals(artKey)) return artData;
        artKey = key;
        artData = null;
        Bitmap b = md.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART);
        if (b == null) b = md.getBitmap(MediaMetadata.METADATA_KEY_ART);
        if (b == null) b = md.getBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON);
        if (b != null) {
            float k = 360f / Math.max(b.getWidth(), b.getHeight());
            if (k < 1) b = Bitmap.createScaledBitmap(b, Math.round(b.getWidth() * k), Math.round(b.getHeight() * k), true);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            b.compress(Bitmap.CompressFormat.JPEG, 85, out);
            artData = "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
        }
        return artData;
    }

    private String appName(String pkg) {
        if (pkg == null) return "";
        if (pkg.startsWith("com.ts.carplay")) return "CarPlay";
        try {
            PackageManager pm = ctx.getPackageManager();
            ApplicationInfo ai = pm.getApplicationInfo(pkg, 0);
            return String.valueOf(pm.getApplicationLabel(ai));
        } catch (Exception e) {
            return pkg;
        }
    }

    void control(String action) {
        MediaController c = current != null ? current : pick();
        if (c == null) return;
        MediaController.TransportControls t = c.getTransportControls();
        switch (action) {
            case "play": t.play(); break;
            case "pause": t.pause(); break;
            case "next": t.skipToNext(); break;
            case "prev": t.skipToPrevious(); break;
        }
    }
}
