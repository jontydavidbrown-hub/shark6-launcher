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
    private static final long POLL_MS = 500;

    private WebView web;
    private CarData car;
    private Media media;
    private HandlerThread worker, cmdWorker, fastWorker;
    private Handler bg, cmd, fastH;
    private static final long FAST_MS = 100;
    private long lastSpeed = Long.MIN_VALUE, lastGear = Long.MIN_VALUE;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private volatile boolean resumed;
    private SoundPool sounds;
    private int sfxTap, sfxOn, sfxOff;
    private boolean pageReady;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().setStatusBarColor(Color.BLACK);
        getWindow().setNavigationBarColor(Color.BLACK);
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
        web.addJavascriptInterface(new Bridge(), "Car");
        web.setWebViewClient(new WebViewClient() {
            @Override public void onPageFinished(WebView view, String url) { pageReady = true; }
        });
        setContentView(web);
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

    // OTA: look for a newer build shortly after start (lets Wi-Fi/4G come up), then again whenever
    // the home screen comes back into view, at most every 15 minutes.
    private static final long UPDATE_EVERY_MS = 15 * 60 * 1000;
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
                long sp = Math.round(f[0]), g = Math.round(f[1]);
                if (sp != lastSpeed || g != lastGear) {
                    lastSpeed = sp; lastGear = g;
                    pushJs("window.onFast && window.onFast(" + sp + "," + g + ")");
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
        maybeCheckForUpdate();
    }

    @Override protected void onPause() {
        super.onPause();
        resumed = false;
        bg.removeCallbacks(poll);
        fastH.removeCallbacks(fastPoll);
    }

    @Override protected void onDestroy() {
        fastWorker.quitSafely();
        worker.quitSafely();
        cmdWorker.quitSafely();
        web.destroy();
        sounds.release();
        super.onDestroy();
    }

    @Override public void onBackPressed() { /* this is the home screen: nothing to go back to */ }

    private void launch(String pkg) {
        Intent i = getPackageManager().getLaunchIntentForPackage(pkg);
        if (i == null) { toast("Couldn't find " + pkg); return; }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        startActivity(i);
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
        }
        @JavascriptInterface public void media(String action) { bg.post(() -> media.control(action)); }
        @JavascriptInterface public void sfx(String name) {
            int id = "on".equals(name) ? sfxOn : "off".equals(name) ? sfxOff : sfxTap;
            sounds.play(id, 0.6f, 0.6f, 1, 0, 1f);
        }
        @JavascriptInterface public void toast(String m) { MainActivity.this.toast(m); }
        @JavascriptInterface public void installUpdate(String url) {
            new Thread(() -> Updater.install(MainActivity.this, url, new Updater.Progress() {
                @Override public void percent(int p) { pushJs("window.onUpdateProgress && window.onUpdateProgress(" + p + ")"); }
                @Override public void failed(String why) { pushJs("window.onUpdateFailed && window.onUpdateFailed(" + JSONObject.quote(why) + ")"); }
            }), "ota").start();
        }
        @JavascriptInterface public String version() {
            try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception e) { return ""; }
        }
    }
}
