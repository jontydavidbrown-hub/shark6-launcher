package au.jonty.shark6.launcher;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.media.SoundPool;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

/**
 * The home screen: the approved HTML design in a WebView, fed live car data twice a second.
 * Runs as a normal window (not immersive) so BYD's header bar stays visible.
 */
public class MainActivity extends Activity {
    private static volatile boolean showing;
    static boolean isShowing() { return showing; }
    private static final long POLL_MS = 500;

    private WebView web;
    private CarData car;
    private Media media;
    private HandlerThread worker, cmdWorker, fastWorker;
    private Handler bg, cmd, fastH;
    private static final long FAST_MS = 100;
    private long lastSpeed = Long.MIN_VALUE, lastGear = Long.MIN_VALUE, lastTurn = Long.MIN_VALUE;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private MusicCard musicCard;
    private volatile boolean resumed;
    private SoundPool sounds;
    private int sfxTap, sfxOn, sfxOff;
    private boolean pageReady;
    private CamView cam, cam2, cam3;
    private Tilt tilt;
    private Compass compass;
    private static boolean welcomed;
    private CamFeed feed;
    private boolean camPlaced, reversing;

    /** Cameras run only while the home screen is showing, has placed the camera box, and the car isn't in reverse. */
    private void updateCamera() {
        if (feed == null) return;
        if (resumed && camPlaced && !reversing) feed.start(); else feed.stop();
    }

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        Wake.start(this);
        Sideload.start(this);
        getWindow().setStatusBarColor(Color.BLACK);
        getWindow().setNavigationBarColor(Color.BLACK);
        getWindow().getDecorView().setOnSystemUiVisibilityChangeListener(v -> {
            if ((v & View.SYSTEM_UI_FLAG_HIDE_NAVIGATION) == 0) { ui.removeCallbacks(rehide); ui.postDelayed(rehide, 3000); }
        });
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#050505"));
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setAllowFileAccess(true);
        s.setTextZoom(100);
        s.setSupportZoom(false);
        Bridge bridge = new Bridge();
        web.addJavascriptInterface(bridge, "Car");
        Sideload.diagSource = bridge::diag;
        web.setWebViewClient(new WebViewClient() {
            @Override public void onPageFinished(WebView view, String url) { pageReady = true; }
        });
        // Live camera pictures, drawn over the page's two camera boxes (see camRects): front and left to start.
        cam = new CamView(this, 0);
        cam2 = new CamView(this, 3);
        cam3 = new CamView(this, 0);      // big front view at low speed
        cam.setZOrderMediaOverlay(true);
        cam2.setZOrderMediaOverlay(true);
        cam3.setZOrderMediaOverlay(true);
        feed = new CamFeed(this, t -> pushJs("window.onCamStatus && window.onCamStatus(" + JSONObject.quote(t) + ")"), cam, cam2, cam3);
        tilt = new Tilt(this);
        compass = new Compass(this);
        android.widget.FrameLayout root = new android.widget.FrameLayout(this);
        root.addView(web, new android.widget.FrameLayout.LayoutParams(-1, -1));
        root.addView(cam, new android.widget.FrameLayout.LayoutParams(1, 1));
        root.addView(cam2, new android.widget.FrameLayout.LayoutParams(1, 1));
        root.addView(cam3, new android.widget.FrameLayout.LayoutParams(1, 1));
        setContentView(root);
        web.loadUrl("file:///android_asset/index.html");

        // Button sounds: sonification usage, so they mix over music instead of pausing it.
        sounds = new SoundPool.Builder().setMaxStreams(3).setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()).build();
        sfxTap = sounds.load(this, R.raw.sfx_tap, 1);
        sfxOn = sounds.load(this, R.raw.sfx_on, 1);
        sfxOff = sounds.load(this, R.raw.sfx_off, 1);

        car = new CarData(this);
        media = new Media(this);
        musicCard = new MusicCard(this);
        musicCard.start();
        media.card = musicCard;
        worker = new HandlerThread("car-poll");
        worker.start();
        bg = new Handler(worker.getLooper());
        bg.post(car::open);
        cmdWorker = new HandlerThread("car-cmd");
        cmdWorker.start();
        cmd = new Handler(cmdWorker.getLooper());
        fastWorker = new HandlerThread("car-fast");
        fastWorker.start();
        fastH = new Handler(fastWorker.getLooper());

    }

    // OTA: look for a newer build shortly after start (lets Wi-Fi/4G come up), then every
    // 10 minutes while the home screen is showing, and again whenever it comes back into view.
    private static final long UPDATE_EVERY_MS = 10 * 60 * 1000;
    private final Runnable updateTick = new Runnable() {
        @Override public void run() {
            if (!resumed) return;
            maybeCheckForUpdate();
            ui.postDelayed(this, UPDATE_EVERY_MS + 1000);
        }
    };
    private long lastUpdateCheck;
    private final Runnable updateCheck = () -> {
        lastUpdateCheck = System.currentTimeMillis();
        JSONObject u = Updater.check(this);
        if (u != null) pushJs("window.onUpdate && window.onUpdate(" + JSONObject.quote(u.toString()) + ")");
    };
    private void maybeCheckForUpdate() {
        if (lastUpdateCheck != 0 && System.currentTimeMillis() - lastUpdateCheck < UPDATE_EVERY_MS) return;
        lastUpdateCheck = System.currentTimeMillis();
        // Own thread: a slow network must never hold up climate commands or the speedo.
        ui.postDelayed(() -> new Thread(updateCheck, "ota-check").start(), 8000);
    }

    private void pushJs(String js) { ui.post(() -> { if (pageReady) web.evaluateJavascript(js, null); }); }

    private final Runnable poll = new Runnable() {
        @Override public void run() {
            if (!resumed) return;
            JSONObject o = car.read();
            try { o.put("media", media.read()); } catch (Exception ignored) { }
            double[] t = tilt.read();
            if (t != null) try { o.put("tilt", new JSONObject().put("p", Math.round(t[0] * 10) / 10.0).put("r", Math.round(t[1] * 10) / 10.0)); } catch (Exception ignored) { }
            double hd = compass.read();
            if (!Double.isNaN(hd)) try { o.put("heading", Math.round(hd)); } catch (Exception ignored) { }
            final String js = "window.onCar && window.onCar(" + JSONObject.quote(o.toString()) + ")";
            ui.post(() -> { if (pageReady) web.evaluateJavascript(js, null); });
            bg.postDelayed(this, POLL_MS);
        }
    };

    /** Live speedo: speed and gear every 100 ms, sent to the page only when they change. */
    private final Runnable fastPoll = new Runnable() {
        @Override public void run() {
            if (!resumed) return;
            double[] f = car.fast();
            if (f != null) {
                long sp = Math.round(f[0]), g = Math.round(f[1]), tn = Math.round(f[2]);
                if (sp != lastSpeed || g != lastGear || tn != lastTurn) {
                    lastSpeed = sp; lastGear = g; lastTurn = tn;
                    boolean r = g == 2; // R: let BYD's reversing camera have the cameras
                    if (r != reversing) { reversing = r; ui.post(MainActivity.this::updateCamera); }
                    pushJs("window.onFast && window.onFast(" + sp + "," + g + "," + tn + ")");
                }
            }
            fastH.postDelayed(this, FAST_MS);
        }
    };

    @Override protected void onResume() {
        super.onResume();
        resumed = true;
        bg.removeCallbacks(poll);
        bg.post(poll);
        fastH.removeCallbacks(fastPoll);
        fastH.post(fastPoll);
        ui.removeCallbacks(updateTick);
        ui.post(updateTick);
        showing = true;
        cam.onResume();
        cam2.onResume();
        cam3.onResume();
        tilt.start();
        compass.start();
        updateCamera();
    }

    @Override protected void onPause() {
        super.onPause();
        showing = false;
        cam.onPause();
        cam2.onPause();
        cam3.onPause();
        tilt.stop();
        compass.stop();
        resumed = false;
        ui.removeCallbacks(updateTick);
        updateCamera();
        bg.removeCallbacks(poll);
        fastH.removeCallbacks(fastPoll);
    }

    @Override protected void onDestroy() {
        musicCard.stop();
        fastWorker.quitSafely();
        worker.quitSafely();
        cmdWorker.quitSafely();
        web.destroy();
        sounds.release();
        super.onDestroy();
    }

    // Full screen: hide BYD's header and bottom bar (the page shows its own clock). A swipe from the
    // top or bottom edge shows them; they hide again after 3 s, or when the screen is tapped.
    private final Runnable rehide = this::hideBars;
    private void hideBars() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    @Override public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideBars();
    }

    @Override public boolean dispatchTouchEvent(android.view.MotionEvent e) {
        if (e.getActionMasked() == android.view.MotionEvent.ACTION_DOWN
                && (getWindow().getDecorView().getSystemUiVisibility() & View.SYSTEM_UI_FLAG_HIDE_NAVIGATION) == 0) {
            ui.removeCallbacks(rehide);
            ui.postDelayed(rehide, 300);
        }
        return super.dispatchTouchEvent(e);
    }

    @Override public void onBackPressed() { /* this is the home screen: nothing to go back to */ }

    private void launch(String pkg) {
        Intent i = getPackageManager().getLaunchIntentForPackage(pkg);
        if (i == null) { toast("Couldn't find " + pkg); return; }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        startActivity(i);
    }

    private String homeName() {
        try {
            android.content.pm.ResolveInfo r = getPackageManager().resolveActivity(
                    new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), android.content.pm.PackageManager.MATCH_DEFAULT_ONLY);
            return r == null || r.activityInfo == null ? "none" : r.activityInfo.packageName;
        } catch (Exception e) { return "?"; }
    }

    private void toast(String m) { ui.post(() -> Toast.makeText(this, m, Toast.LENGTH_SHORT).show()); }

    /** Called from the page as window.Car.*. Every method runs on a binder thread. */
    private final class Bridge {
        /** Fire-and-forget: runs on its own thread so a tap never waits behind the poll. */
        @JavascriptInterface public void command(String name, String json) {
            cmd.post(() -> {
                String result;
                int id = 0;
                try {
                    JSONObject a = new JSONObject(json);
                    id = a.optInt("id");
                    result = car.command(name, a);
                } catch (Exception e) {
                    result = "error";
                }
                final String js = "window.onCommandResult && window.onCommandResult(" + id + "," + JSONObject.quote(result) + ")";
                ui.post(() -> web.evaluateJavascript(js, null));
                if ("ok".equals(result)) {
                    // Re-read soon so the screen shows the car's real state once it has applied it.
                    bg.removeCallbacks(poll);
                    bg.postDelayed(poll, 250);
                }
            });
        }
        @JavascriptInterface public void openCarPlay() { ui.post(() -> launch("com.ts.carplay.app")); }
        @JavascriptInterface public void openApp(String which) {
            if ("energy".equals(which)) ui.post(() -> launch("com.byd.dlc.drivingmode"));
            // BYD's own home screen (with its app tray), now that this app is the home screen.
            if ("byd".equals(which)) ui.post(() -> {
                Intent home = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME);
                for (android.content.pm.ResolveInfo r : getPackageManager().queryIntentActivities(home, 0)) {
                    if (r.activityInfo == null || getPackageName().equals(r.activityInfo.packageName)) continue;
                    if ("com.android.settings".equals(r.activityInfo.packageName)) continue;
                    try {
                        startActivity(new Intent(home).setClassName(r.activityInfo.packageName, r.activityInfo.name)
                                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                        return;
                    } catch (Exception ignored) { }
                }
                toast("Couldn't find BYD's home screen");
            });
            // BYD's own 360 camera view (probe 0.7: Android exposes no camera feeds to apps, so we open theirs).
            if ("cameras".equals(which)) ui.post(() -> {
                Intent i = new Intent().setClassName("com.byd.avm", "com.byd.avm.MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try { startActivity(i); } catch (Exception e) { launch("com.ts.avm"); }
            });
        }
        @JavascriptInterface public void media(String action) { cmd.post(() -> media.control(action)); }
        @JavascriptInterface public void sfx(String name) {
            int id = "on".equals(name) ? sfxOn : "off".equals(name) ? sfxOff : sfxTap;
            float vol = "tick".equals(name) ? 0.3f : 0.6f;
            sounds.play(id, vol, vol, 1, 0, "tick".equals(name) ? 1.4f : 1f);
        }
        /** Where the page's two camera boxes are, in screen pixels: "left,top,width,height;left,top,width,height". */
        @JavascriptInterface public void camRects(String r) {
            String[] boxes = r.split(";");
            ui.post(() -> {
                boolean placed = false;
                CamView[] views = { cam, cam2, cam3 };
                for (int i = 0; i < views.length; i++) {
                    String[] p = i < boxes.length ? boxes[i].split(",") : new String[0];
                    int x = 0, y = 0, w = 0, h = 0;
                    if (p.length == 4) try {
                        x = Integer.parseInt(p[0]); y = Integer.parseInt(p[1]); w = Integer.parseInt(p[2]); h = Integer.parseInt(p[3]);
                    } catch (NumberFormatException ignored) { }
                    android.widget.FrameLayout.LayoutParams lp = new android.widget.FrameLayout.LayoutParams(Math.max(1, w), Math.max(1, h));
                    lp.leftMargin = x; lp.topMargin = y;
                    views[i].setLayoutParams(lp);
                    views[i].setActive(w > 10 && h > 10);
                    placed |= w > 10 && h > 10;
                }
                camPlaced = placed;
                updateCamera();
            });
        }
        /** Which camera a tile shows: view 0 = top tile, 1 = bottom; slot 0 front, 1 right, 2 rear, 3 left. */
        @JavascriptInterface public void camShow(int view, int slot) { (view == 2 ? cam3 : view == 1 ? cam2 : cam).show(slot); }
        /** True once per app start, so the welcome screen shows when the car starts, not on every return home. */
        @JavascriptInterface public boolean firstStart() { boolean f = !welcomed; welcomed = true; return f; }
        @JavascriptInterface public boolean hasTilt() { return tilt.available(); }
        /** Hold the clock for 2 s: what the car SDK opened and where the indicator reading comes from. */
        @JavascriptInterface public String diag() {
            double[] f = car.fast(), t = tilt.read();
            String ver = "?";
            try { ver = getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception ignored) { }
            return "SIDELOAD|" + Sideload.address() + "|" + Sideload.PIN + "\nlast app sent: " + Sideload.last + "\n"
                    + car.powerReport() + "\n" + car.huntReport()
                    + media.report() + "\n"
                    + "Shark 6 Home " + ver + "   home screen: " + homeName() + "\n" + car.openReport()
                    + "turn: " + (f == null ? "-" : (int) f[2]) + " via " + car.turnSource() + "\n"
                    + compass.report() + "\n"
                    + "tilt sensor: " + tilt.available() + (t == null ? "" : String.format(" pitch %.1f roll %.1f", t[0], t[1])) + "\n"
                    + "draw over apps: " + android.provider.Settings.canDrawOverlays(MainActivity.this) + "   last wake: " + Wake.lastWake + "\n"
                    + "media access: " + getSystemService(android.app.NotificationManager.class)
                            .isNotificationListenerAccessGranted(new android.content.ComponentName(MainActivity.this, MediaListener.class)) + "\n"
                    + "trip reset: " + car.lastTripReset;
        }
        /** Diagnostics overlay button: posts diagnostics + probe to GitHub for Claude. Answers via window.onReportSent. */
        @JavascriptInterface public void sendToClaude(String extra) {
            final String d = diag() + (extra == null ? "" : "\n" + extra);
            new Thread(() -> {
                String r = Report.send(MainActivity.this, d, Cameras.shell(MainActivity.this, Sideload.PROBE));
                pushJs("window.onReportSent && window.onReportSent(" + JSONObject.quote(r) + ")");
            }, "report").start();
        }
        @JavascriptInterface public void zeroTilt() { tilt.zero(); }
        @JavascriptInterface public void toast(String m) { MainActivity.this.toast(m); }
        @JavascriptInterface public void installUpdate(String url) {
            new Thread(() -> Updater.install(MainActivity.this, url, new Updater.Progress() {
                @Override public void percent(int p) { pushJs("window.onUpdateProgress && window.onUpdateProgress(" + p + ")"); }
                @Override public void failed(String why) { pushJs("window.onUpdateFailed && window.onUpdateFailed(" + JSONObject.quote(why) + ")"); }
            }), "ota").start();
        }
        /** Manual "check for updates": shows the update sheet, or tells the page it is up to date. */
        @JavascriptInterface public void checkUpdate() {
            new Thread(() -> {
                lastUpdateCheck = System.currentTimeMillis();
                JSONObject u = Updater.check(MainActivity.this);
                if (u != null) pushJs("window.onUpdate && window.onUpdate(" + JSONObject.quote(u.toString()) + ")");
                else pushJs("window.onNoUpdate && window.onNoUpdate()");
            }, "ota-check-now").start();
        }
        @JavascriptInterface public String version() {
            try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception e) { return ""; }
        }
    }
}
