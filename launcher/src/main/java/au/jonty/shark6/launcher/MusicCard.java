package au.jonty.shark6.launcher;

import android.appwidget.AppWidgetHost;
import android.appwidget.AppWidgetHostView;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProviderInfo;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.BitmapDrawable;
import android.graphics.drawable.Drawable;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageView;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.List;

/**
 * CarPlay song info. CarPlay gives Android no media session, but BYD's music app (com.byd.localmusic)
 * gets the song from the iPhone and shows it in its home-screen widget. We host that same widget
 * off screen and read its text and picture. Binding a widget needs `appwidget grantbind`, done
 * through the car's ADB the first time.
 */
final class MusicCard {
    private static final int HOST_ID = 0x5A6;
    private static final String PKG = "com.byd.localmusic";
    private final Context ctx;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private AppWidgetHost host;
    private AppWidgetHostView view;
    private boolean triedGrant;
    static volatile String[] texts = new String[0];
    // Progress bar in the widget, as a fraction (or -1 if it has none).
    static volatile float progress = -1;
    static volatile long progressAt;
    static volatile Bitmap art;
    static volatile String report = "music card: not started";

    MusicCard(Context c) { ctx = c.getApplicationContext(); }

    /** Main thread. */
    void start() {
        try {
            AppWidgetManager am = AppWidgetManager.getInstance(ctx);
            StringBuilder found = new StringBuilder();
            AppWidgetProviderInfo pick = null;
            for (AppWidgetProviderInfo p : am.getInstalledProviders()) {
                String n = p.provider.flattenToShortString();
                if (!p.provider.getPackageName().equals(PKG)) continue;
                found.append(n).append(' ');
                String lc = n.toLowerCase(java.util.Locale.ROOT);
                if (pick == null || lc.contains("music") || lc.contains("media")) pick = p;
            }
            if (pick == null) { report = "music card: BYD music app has no widget"; return; }
            if (host == null) { host = new AppWidgetHost(ctx, HOST_ID); host.startListening(); }
            SharedPreferences sp = ctx.getSharedPreferences("musiccard", 0);
            int id = sp.getInt("id", -1);
            AppWidgetProviderInfo bound = id < 0 ? null : am.getAppWidgetInfo(id);
            if (bound == null || !bound.provider.equals(pick.provider)) {
                if (id >= 0) host.deleteAppWidgetId(id);
                id = host.allocateAppWidgetId();
                sp.edit().putInt("id", id).apply();
                if (!am.bindAppWidgetIdIfAllowed(id, pick.provider)) {
                    report = "music card: waiting for permission (" + found + ")";
                    if (!triedGrant) {
                        triedGrant = true;
                        new Thread(() -> {
                            Cameras.shell(ctx, "appwidget grantbind --package " + ctx.getPackageName() + " --user 0");
                            ui.postDelayed(this::start, 1000);
                        }, "widget-grant").start();
                    }
                    return;
                }
                bound = am.getAppWidgetInfo(id);
            }
            view = host.createView(ctx, id, bound);
            report = "music card: hosting " + pick.provider.flattenToShortString();
            ui.removeCallbacks(snap);
            ui.postDelayed(snap, 1500);
        } catch (Throwable t) {
            report = "music card: " + t;
        }
    }

    void stop() {
        ui.removeCallbacks(snap);
        try { if (host != null) host.stopListening(); } catch (Throwable ignored) { }
    }

    // Lay the widget out off screen every 2 s and read what it shows.
    private final Runnable snap = new Runnable() {
        @Override public void run() {
            try {
                if (view != null) {
                    int w = View.MeasureSpec.makeMeasureSpec(900, View.MeasureSpec.EXACTLY);
                    int h = View.MeasureSpec.makeMeasureSpec(400, View.MeasureSpec.EXACTLY);
                    view.measure(w, h);
                    view.layout(0, 0, 900, 400);
                    List<String> t = new ArrayList<>();
                    Bitmap[] best = new Bitmap[1];
                    float[] prog = { -1 };
                    walk(view, t, best, prog);
                    texts = t.toArray(new String[0]);
                    progress = prog[0];
                    progressAt = android.os.SystemClock.elapsedRealtime();
                    art = best[0];
                    report = "music card: texts " + t + (best[0] != null ? ", picture " + best[0].getWidth() + "x" + best[0].getHeight() : ", no picture");
                }
            } catch (Throwable e) {
                report = "music card: read failed " + e;
            }
            ui.postDelayed(this, 1000);
        }
    };

    /** Read again soon, e.g. right after a play/pause/skip tap. */
    void refreshSoon() {
        ui.removeCallbacks(snap);
        ui.postDelayed(snap, 300);
    }

    private static void walk(View v, List<String> out, Bitmap[] best, float[] prog) {
        if (v.getVisibility() != View.VISIBLE) return;
        if (v instanceof android.widget.ProgressBar) {
            android.widget.ProgressBar pb = (android.widget.ProgressBar) v;
            if (pb.getMax() > 0 && !pb.isIndeterminate()) prog[0] = pb.getProgress() / (float) pb.getMax();
        }
        if (v instanceof TextView) {
            CharSequence s = ((TextView) v).getText();
            if (s != null && s.toString().trim().length() > 0) out.add(s.toString().trim());
        } else if (v instanceof ImageView) {
            Drawable d = ((ImageView) v).getDrawable();
            // Album art is roughly square and has real picture detail (skips plain placeholder shapes).
            float ar = d == null || d.getIntrinsicHeight() <= 0 ? 0 : d.getIntrinsicWidth() / (float) d.getIntrinsicHeight();
            if (d != null && d.getIntrinsicWidth() >= 80 && d.getIntrinsicHeight() >= 80 && ar > 0.75f && ar < 1.33f) {
                Bitmap b;
                if (d instanceof BitmapDrawable) b = ((BitmapDrawable) d).getBitmap();
                else {
                    b = Bitmap.createBitmap(Math.min(512, d.getIntrinsicWidth()), Math.min(512, d.getIntrinsicHeight()), Bitmap.Config.ARGB_8888);
                    d.setBounds(0, 0, b.getWidth(), b.getHeight());
                    d.draw(new Canvas(b));
                }
                if (b != null && looksLikePicture(b) && (best[0] == null || b.getWidth() * b.getHeight() > best[0].getWidth() * best[0].getHeight())) best[0] = b;
            }
        }
        if (v instanceof ViewGroup) {
            ViewGroup g = (ViewGroup) v;
            for (int i = 0; i < g.getChildCount(); i++) walk(g.getChildAt(i), out, best, prog);
        }
    }

    /** True when the bitmap has many different colours (a cover), not a flat or two-tone shape. */
    private static boolean looksLikePicture(Bitmap b) {
        try {
            java.util.HashSet<Integer> seen = new java.util.HashSet<>();
            int w = b.getWidth(), h = b.getHeight();
            for (int y = 0; y < 12; y++) for (int x = 0; x < 12; x++) {
                int c = b.getPixel(x * (w - 1) / 11, y * (h - 1) / 11);
                seen.add(c & 0xF0F0F0);
            }
            return seen.size() >= 12;
        } catch (Throwable t) {
            return false;
        }
    }
}
