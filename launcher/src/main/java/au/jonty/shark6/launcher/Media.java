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
            + " echo '=='; for id in $(pidof com.byd.localmusic); do logcat -d -t 3000 --pid=$id 2>/dev/null | grep -E 'onPropertyChanged: isPlaying|notifyAlbumRunnable' | tail -6; done";
    // Album art: BYD's media center saves each CarPlay cover as "/album/<hash>.png" and logs it.
    static volatile String albumPath, albumReport = "album art: none logged yet";
    private static volatile String albumData;
    private static String albumTried;
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
                Boolean bydPlaying = null;
                String album = null;
                for (String l : byd.split("\n")) {
                    if (l.contains("isPlaying = true")) bydPlaying = Boolean.TRUE;
                    else if (l.contains("isPlaying = false")) bydPlaying = Boolean.FALSE;
                    int k = l.indexOf("finalPath = ");
                    if (k >= 0) album = l.substring(k + 12).trim();
                }
                if (album != null && !album.equals(albumTried)) { albumTried = album; loadAlbum(album); }
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

    private void loadAlbum(String rel) {
        String name = rel.substring(rel.lastIndexOf('/') + 1).replaceAll("[^A-Za-z0-9._-]", "");
        if (name.isEmpty()) return;
        String r = Cameras.shell(ctx, "f=''; for c in " + rel.replaceAll("[^A-Za-z0-9._/-]", "")
                + " $(find /sdcard/ /storage/emulated/0/ /data/media/0/ /mnt/ -name " + name + " 2>/dev/null | head -3); do [ -r \"$c\" ] && f=$c && break; done;"
                + " echo \"$f\"; [ -n \"$f\" ] && base64 \"$f\" | tr -d '\\n'");
        if (r == null) { albumReport = "album art: car ADB not reachable"; return; }
        int nl = r.indexOf('\n');
        String file = nl < 0 ? r.trim() : r.substring(0, nl).trim();
        if (file.isEmpty() || nl < 0) { albumReport = "album art: " + rel + " not found or not readable"; return; }
        try {
            byte[] png = Base64.decode(r.substring(nl + 1).trim(), Base64.DEFAULT);
            Bitmap b = android.graphics.BitmapFactory.decodeByteArray(png, 0, png.length);
            if (b == null) { albumReport = "album art: " + file + " didn't decode"; return; }
            albumData = toJpeg(b);
            albumReport = "album art: " + file + " " + b.getWidth() + "x" + b.getHeight();
        } catch (Exception e) {
            albumReport = "album art: " + e;
        }
    }

    private static String toJpeg(Bitmap b) {
        float k = 360f / Math.max(b.getWidth(), b.getHeight());
        if (k < 1) b = Bitmap.createScaledBitmap(b, Math.round(b.getWidth() * k), Math.round(b.getHeight() * k), true);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        b.compress(Bitmap.CompressFormat.JPEG, 85, out);
        return "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
    }

    static long parseTime(String t) {
        boolean neg = t.startsWith("-");
        long ms = 0;
        for (String p : t.replace("-", "").split(":")) ms = ms * 60 + Long.parseLong(p);
        ms *= 1000;
        return neg ? -ms : ms;
    }

    MusicCard card;
    private Bitmap cardArtSrc;
    private String cardArtData;

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
                // Song from BYD's music widget when it has one (see MusicCard).
                List<String> words = new java.util.ArrayList<>();
                List<Long> times = new java.util.ArrayList<>();
                for (String t : MusicCard.texts) {
                    if (t.matches("-?\\d{1,2}(:\\d{2}){1,2}")) { times.add(parseTime(t)); continue; }
                    if (t.matches("[-\\d:./ ]+") || t.equalsIgnoreCase("CarPlay") || t.length() > 120) continue;
                    if (!words.contains(t)) words.add(t);
                }
                // Times: the widget shows elapsed and total (as text), and maybe a progress bar.
                if (times.size() >= 2) {
                    long pos = Math.abs(times.get(0)), dur = Math.abs(times.get(1));
                    if (times.get(1) < 0) dur = pos + dur; // "-1:23" style remaining time
                    o.put("pos", pos); o.put("dur", dur);
                } else if (times.size() == 1 && MusicCard.progress > 0) {
                    long dur = Math.abs(times.get(0));
                    o.put("pos", (long) (dur * MusicCard.progress)); o.put("dur", dur);
                }
                o.put("title", !words.isEmpty() ? words.get(0) : cpPlaying ? "Playing on CarPlay" : "CarPlay paused");
                if (words.size() > 1) o.put("artist", words.get(1));
                o.put("app", "CarPlay");
                o.put("playing", cpPlaying);
                Bitmap ca = MusicCard.art;
                if (ca != null && ca != cardArtSrc) { cardArtSrc = ca; cardArtData = toJpeg(ca); }
                String artUrl = albumData != null ? albumData : ca != null ? cardArtData : null;
                if (artUrl != null) o.put("art", artUrl);
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
        b.append('\n').append(cpReport).append('\n').append(albumReport).append('\n').append(MusicCard.report);
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
            // Media keys go to the media button session, which is BYD's media center: it passes them
            // straight to CarPlay. Sent from here, so there's no ADB round trip.
            final int key = action.equals("next") ? 87 : action.equals("prev") ? 88 : 85;
            try {
                android.media.AudioManager am = (android.media.AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
                long t = SystemClock.uptimeMillis();
                am.dispatchMediaKeyEvent(new android.view.KeyEvent(t, t, android.view.KeyEvent.ACTION_DOWN, key, 0));
                am.dispatchMediaKeyEvent(new android.view.KeyEvent(t, t, android.view.KeyEvent.ACTION_UP, key, 0));
            } catch (Throwable e) {
                new Thread(() -> Cameras.shell(ctx, "input keyevent " + key), "carplay-key").start();
            }
            if (card != null) card.refreshSoon();
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
