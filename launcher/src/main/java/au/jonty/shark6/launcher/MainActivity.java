package au.jonty.shark6.launcher;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
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
    private HandlerThread worker, cmdWorker;
    private Handler bg, cmd;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private volatile boolean resumed;
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

        car = new CarData(this);
        media = new Media(this);
        worker = new HandlerThread("car-poll");
        worker.start();
        bg = new Handler(worker.getLooper());
        bg.post(car::open);
        cmdWorker = new HandlerThread("car-cmd");
        cmdWorker.start();
        cmd = new Handler(cmdWorker.getLooper());
    }

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

    @Override protected void onResume() {
        super.onResume();
        resumed = true;
        bg.removeCallbacks(poll);
        bg.post(poll);
    }

    @Override protected void onPause() {
        super.onPause();
        resumed = false;
        bg.removeCallbacks(poll);
    }

    @Override protected void onDestroy() {
        worker.quitSafely();
        cmdWorker.quitSafely();
        web.destroy();
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
        @JavascriptInterface public void toast(String m) { MainActivity.this.toast(m); }
    }
}
