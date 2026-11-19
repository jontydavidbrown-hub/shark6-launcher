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
                if (s == null) continue;
                int st = s.getState();
                if (st == PlaybackState.STATE_PLAYING) return c;
                // Skip sessions that are idle or errored (e.g. Spotify "please log in", BT disconnected).
                if (st == PlaybackState.STATE_NONE || st == PlaybackState.STATE_ERROR || st == PlaybackState.STATE_STOPPED) continue;
                // A paused player with nothing loaded (e.g. Amazon sitting idle) would only hide CarPlay.
                MediaMetadata md = c.getMetadata();
                if (best == null && md != null && md.getString(MediaMetadata.METADATA_KEY_TITLE) != null) best = c;
            }
            if (best != null) return best;
            // Some players never report a playback state: take one that at least names a track.
            for (MediaController c : list) {
                MediaMetadata md = c.getMetadata();
                if (md != null && md.getString(MediaMetadata.METADATA_KEY_TITLE) != null) return c;
            }
            return null;
        } catch (SecurityException e) {
            return null; // listener not allowed yet
        }
    }

    // ---- CarPlay ----
    // CarPlay (com.ts.carplay) plays through Android audio but publishes no media session or
    // notification, so read the audio focus stack and active players through the car's ADB.
    static volatile boolean cpFocus, cpPlaying;
    static volatile String cpReport = "carplay audio: not checked yet";
    private static volatile long cpAt;
    private static volatile boolean cpBusy;
    // BYD's media center logs CarPlay's real play state ("isPlaying = true/false"); CarPlay itself
    // keeps its audio stream open while paused, so that log is the reliable signal.
    private static final String CP_CMD = "dumpsys audio | grep -A12 'Audio Focus stack entries'; echo '=='; dumpsys audio | grep -E 'state:(started|paused)';"
            + " echo '=='; for id in $(pidof com.byd.localmusic); do logcat -d -t 3000 --pid=$id 2>/dev/null | grep 'onPropertyChanged: isPlaying' | tail -1; done";
    private static volatile long cpHoldUntil;
    private static volatile boolean cpHeld;

    private void checkCarPlay() {
        long now = SystemClock.elapsedRealtime();
        if (cpBusy || now - cpAt < 2500) return;
        cpBusy = true; cpAt = now;
        new Thread(() -> {
            try {
                String r = Cameras.shell(ctx, CP_CMD);
                if (r == null) { cpReport = "carplay audio: car ADB not reachable"; return; }
                int sep = r.indexOf("\n==");
                String focus = sep < 0 ? r : r.substring(0, sep), players = sep < 0 ? "" : r.substring(sep);
                int sep2 = players.indexOf("\n==", 1);
                String byd = sep2 < 0 ? "" : players.substring(sep2);
                if (sep2 >= 0) players = players.substring(0, sep2);
                Boolean bydPlaying = byd.contains("isPlaying = true") ? Boolean.TRUE : byd.contains("isPlaying = false") ? Boolean.FALSE : null;
                // Top of the focus stack is the last "source:" line in the block.
                String top = null;
                boolean inStack = false;
                for (String l : focus.split("\n")) {
                    if (l.contains("Audio Focus stack entries")) { inStack = true; continue; }
                    if (!inStack) continue;
                    if (l.contains("source:")) top = l; else if (top != null) break;
                }
                boolean f = top != null && top.contains("com.ts.carplay") && top.contains("MediaListener");
                boolean anyCp = false, started = false;
                for (String l : players.split("\n")) {
                    if (!l.contains("CP_MEDIA")) continue;
                    anyCp = true;
                    if (l.contains("state:started")) started = true;
                }
                cpFocus = f;
                // If the players list doesn't show CarPlay at all, trust audio focus alone.
                boolean playing = bydPlaying != null ? bydPlaying : (started || !anyCp);
                // Just after a tap on play or pause, keep showing what was tapped until the car catches up.
                if (SystemClock.elapsedRealtime() < cpHoldUntil) playing = cpHeld;
                cpPlaying = f && playing;
                cpReport = "carplay audio: focus " + (f ? "CarPlay" : top == null ? "none" : "other") + ", player " + (anyCp ? (started ? "started" : "paused") : "not listed")
                        + ", BYD media center " + (bydPlaying == null ? "no state" : bydPlaying ? "playing" : "paused");
            } finally {
                cpBusy = false;
            }
        }, "carplay-check").start();
    }

    private boolean carplayMode;

    JSONObject read() {
        JSONObject o = new JSONObject();
        checkCarPlay();
        current = pick();
        carplayMode = false;
        boolean sessionPlaying = false;
        try { sessionPlaying = current != null && current.getPlaybackState() != null && current.getPlaybackState().getState() == PlaybackState.STATE_PLAYING; } catch (Exception ignored) { }
        if (cpFocus && !sessionPlaying) {
            // CarPlay owns the speakers. Track names stay on the iPhone, so show CarPlay itself.
            carplayMode = true;
            current = null;
            try {
                o.put("title", cpPlaying ? "Playing on CarPlay" : "CarPlay paused");
                o.put("app", "CarPlay");
                o.put("playing", cpPlaying);
            } catch (Exception ignored) { }
            return o;
        }
        if (current == null) {
            // No media session: fall back to a now-playing notification (e.g. CarPlay).
            String[] m = MediaListener.lastMedia;
            if (m != null) {
                try {
                    o.put("title", m[1]);
                    if (!m[2].isEmpty()) o.put("artist", m[2]);
                    o.put("app", appName(m[0]));
                    o.put("playing", true);
                } catch (Exception ignored) { }
            }
            return o;
        }
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
            if (!o.has("title") && ps != null && ps.getState() == PlaybackState.STATE_PLAYING) o.put("title", app);
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

    /** Diagnostics: every media session Android reports, and apps with notifications. */
    String report() {
        StringBuilder b = new StringBuilder("media sessions:");
        try {
            MediaSessionManager msm = (MediaSessionManager) ctx.getSystemService(Context.MEDIA_SESSION_SERVICE);
            List<MediaController> list = msm.getActiveSessions(listener);
            if (list.isEmpty()) b.append(" none");
            for (MediaController c : list) {
                PlaybackState s = c.getPlaybackState();
                MediaMetadata md = c.getMetadata();
                b.append(' ').append(c.getPackageName()).append('[').append(s == null ? "no state" : String.valueOf(s.getState()))
                        .append(md != null && md.getString(MediaMetadata.METADATA_KEY_TITLE) != null ? ", titled" : "").append(']');
            }
        } catch (Exception e) {
            b.append(' ').append(e.getClass().getSimpleName());
        }
        String[] m = MediaListener.lastMedia;
        b.append('\n').append(cpReport);
        b.append("\nnotification player: ").append(m == null ? "none" : m[0] + " \"" + m[1] + "\"");
        b.append("\napps with notifications: ").append(MediaListener.seen.isEmpty() ? "none seen" : MediaListener.seen);
        return b.toString();
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
        if (carplayMode) {
            // No session to control: send media keys, which CarPlay passes on to the iPhone.
            final int key = action.equals("next") ? 87 : action.equals("prev") ? 88 : 85;
            new Thread(() -> Cameras.shell(ctx, "input keyevent " + key), "carplay-key").start();
            if (action.equals("play") || action.equals("pause")) {
                cpPlaying = cpHeld = action.equals("play");
                cpHoldUntil = SystemClock.elapsedRealtime() + 5000;
            }
            return;
        }
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
