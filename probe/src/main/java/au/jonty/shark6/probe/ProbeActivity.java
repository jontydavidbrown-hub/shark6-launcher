package au.jonty.shark6.probe;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.PermissionInfo;
import android.content.pm.ResolveInfo;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.widget.ScrollView;
import android.widget.TextView;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileWriter;
import java.io.InputStreamReader;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Enumeration;
import java.util.List;
import java.util.Locale;
import java.util.TreeSet;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import dalvik.system.DexFile;

/**
 * Read-only survey of what BYD's vehicle software exposes to a sideloaded app.
 * It never calls a set/start/stop method, so it cannot change anything in the car.
 */
public class ProbeActivity extends Activity {

    private static final String[] SUBSYSTEMS = {
            "ac", "energy", "charging", "power", "bodywork", "setting", "instrument",
            "statistic", "speed", "gearbox", "engine", "tyre", "light", "sensor",
            "seat", "doorlock", "safetybelt", "radar", "panorama", "multimedia", "adas",
            "fuel", "vehicle", "hvac", "battery"
    };

    /** Words that hint a getter is relevant to the launcher tiles. */
    private static final String[] INTEREST = {
            "soc", "elec", "battery", "mileage", "range", "endurance", "fuel", "oil", "power",
            "energy", "mode", "temp", "wind", "fan", "defrost", "demist", "seat", "heat", "vent", "cool"
    };

    private final StringBuilder summary = new StringBuilder();
    private final StringBuilder full = new StringBuilder();
    private TextView view;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ExecutorService callExecutor = Executors.newSingleThreadExecutor();

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        view = new TextView(this);
        view.setTypeface(Typeface.MONOSPACE);
        view.setTextSize(15);
        view.setTextColor(Color.WHITE);
        view.setBackgroundColor(Color.BLACK);
        view.setPadding(32, 32, 32, 32);
        view.setTextIsSelectable(true);
        view.setText("Shark 6 Probe\nRunning read-only checks…");
        ScrollView sv = new ScrollView(this);
        sv.addView(view);
        setContentView(sv);
        new Thread(this::runProbe, "probe").start();
    }

    private void runProbe() {
        try {
            deviceInfo();
            permissions();
            homeScreen();
            carPlay();
            List<String> classes = discoverClasses();
            for (String c : classes) {
                if (c.endsWith("Device")) probeDevice(c);
            }
        } catch (Throwable t) {
            full.append("\nFATAL: ").append(t).append('\n');
        }
        String path = save();
        final String text = "SHARK 6 PROBE: SUMMARY\n(take a photo of this screen, or pull the full report)\n\n"
                + summary + "\nFull report saved to:\n" + path
                + "\nPull it with:\nadb pull " + path + "\n\n────────── FULL REPORT ──────────\n" + full;
        ui.post(() -> view.setText(text));
    }

    // ---------- sections ----------

    private void deviceInfo() {
        full.append("== Device ==\n");
        full.append("Model: ").append(Build.MANUFACTURER).append(' ').append(Build.MODEL).append('\n');
        full.append("Android: ").append(Build.VERSION.RELEASE).append(" (API ").append(Build.VERSION.SDK_INT).append(")\n");
        full.append("Build: ").append(Build.DISPLAY).append('\n');
        for (String p : new String[]{"ro.build.version.incremental", "ro.product.name", "ro.byd.version",
                "ro.build.byd.version", "persist.sys.byd.carmodel", "ro.product.device"}) {
            String v = getprop(p);
            if (!v.isEmpty()) full.append(p).append(" = ").append(v).append('\n');
        }
        summary.append("Android ").append(Build.VERSION.RELEASE).append(" (API ").append(Build.VERSION.SDK_INT)
                .append("), build ").append(Build.DISPLAY).append('\n');
    }

    private void permissions() {
        full.append("\n== BYD permissions on this car ==\n");
        PackageManager pm = getPackageManager();
        int total = 0, granted = 0;
        TreeSet<String> lines = new TreeSet<>();
        try {
            List<PermissionInfo> all = new ArrayList<>();
            all.addAll(pm.queryPermissionsByGroup(null, 0));
            for (android.content.pm.PermissionGroupInfo g : pm.getAllPermissionGroups(0)) {
                all.addAll(pm.queryPermissionsByGroup(g.name, 0));
            }
            for (PermissionInfo p : all) {
                if (!p.name.toUpperCase(Locale.ROOT).contains("BYD")) continue;
                boolean has = checkSelfPermission(p.name) == PackageManager.PERMISSION_GRANTED;
                int base = p.protectionLevel & PermissionInfo.PROTECTION_MASK_BASE;
                String level = base == PermissionInfo.PROTECTION_NORMAL ? "normal"
                        : base == PermissionInfo.PROTECTION_DANGEROUS ? "dangerous"
                        : base == PermissionInfo.PROTECTION_SIGNATURE ? "signature" : ("level " + base);
                if (lines.add(String.format(Locale.ROOT, "%-45s %-10s %s", p.name, level, has ? "GRANTED" : "-"))) {
                    total++;
                    if (has) granted++;
                }
            }
        } catch (Throwable t) {
            full.append("error: ").append(t).append('\n');
        }
        for (String l : lines) full.append(l).append('\n');
        summary.append("BYD permissions: ").append(granted).append(" of ").append(total).append(" granted to this app\n");
    }

    private void homeScreen() {
        full.append("\n== Home screen ==\n");
        PackageManager pm = getPackageManager();
        Intent home = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME);
        List<ResolveInfo> list = pm.queryIntentActivities(home, 0);
        for (ResolveInfo r : list) {
            full.append("home app: ").append(r.activityInfo.packageName).append('/').append(r.activityInfo.name)
                    .append(" priority=").append(r.priority).append('\n');
        }
        ResolveInfo def = pm.resolveActivity(home, PackageManager.MATCH_DEFAULT_ONLY);
        String d = def == null ? "none" : def.activityInfo.packageName + "/" + def.activityInfo.name;
        full.append("default: ").append(d).append('\n');
        boolean settingsPage = new Intent(android.provider.Settings.ACTION_HOME_SETTINGS).resolveActivity(pm) != null;
        full.append("'Default home app' settings page exists: ").append(settingsPage).append('\n');
        summary.append("Home apps installed: ").append(list.size()).append(", current: ").append(d)
                .append(", home-app settings page: ").append(settingsPage ? "yes" : "no").append('\n');
    }

    /** Finds the CarPlay / phone-projection app and checks whether it shares "now playing" info. */
    private void carPlay() {
        full.append("\n== CarPlay / media apps ==\n");
        PackageManager pm = getPackageManager();
        int matches = 0;
        StringBuilder names = new StringBuilder();
        for (android.content.pm.ApplicationInfo ai : pm.getInstalledApplications(0)) {
            String p = ai.packageName.toLowerCase(Locale.ROOT);
            String label = String.valueOf(pm.getApplicationLabel(ai));
            String l = label.toLowerCase(Locale.ROOT);
            boolean projection = p.contains("carplay") || p.contains("carlink") || p.contains("zlink")
                    || p.contains("cplay") || p.contains("projection") || l.contains("carplay");
            boolean nav = p.contains("navi") || p.contains("map") || l.contains("map");
            boolean media = p.contains("music") || p.contains("media");
            if (!(projection || nav || media)) continue;
            Intent launch = pm.getLaunchIntentForPackage(ai.packageName);
            boolean hasMediaService = !pm.queryIntentServices(
                    new Intent("android.media.browse.MediaBrowserService").setPackage(ai.packageName), 0).isEmpty();
            full.append(projection ? "[projection] " : nav ? "[maps] " : "[media] ")
                    .append(label).append(" (").append(ai.packageName).append(")")
                    .append(launch != null ? " launchable" : " not-launchable")
                    .append(hasMediaService ? " shares-media" : "").append('\n');
            if (projection) {
                matches++;
                names.append(label).append(launch != null ? " (can open)" : " (no launcher)")
                        .append(hasMediaService ? " shares-media" : "").append("; ");
            }
        }
        boolean listenerSettings = new Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS").resolveActivity(pm) != null;
        full.append("Notification-access settings page exists: ").append(listenerSettings).append('\n');
        summary.append("CarPlay apps: ").append(matches == 0 ? "none found by name" : names.toString()).append('\n')
                .append("Now-playing access page: ").append(listenerSettings ? "yes" : "no").append('\n');
        summary.append("Now playing: ").append(nowPlaying()).append('\n');
    }

    /** Reads active media sessions (needs notification access granted to MediaListener). */
    private String nowPlaying() {
        full.append("\n== Active media sessions ==\n");
        try {
            android.media.session.MediaSessionManager msm =
                    (android.media.session.MediaSessionManager) getSystemService(Context.MEDIA_SESSION_SERVICE);
            List<android.media.session.MediaController> list = msm.getActiveSessions(
                    new android.content.ComponentName(this, MediaListener.class));
            if (list.isEmpty()) return "access OK, but nothing is playing (play a song in CarPlay and reopen)";
            StringBuilder sb = new StringBuilder();
            for (android.media.session.MediaController c : list) {
                android.media.MediaMetadata md = c.getMetadata();
                android.media.session.PlaybackState ps = c.getPlaybackState();
                String title = md == null ? "?" : String.valueOf(md.getString(android.media.MediaMetadata.METADATA_KEY_TITLE));
                String artist = md == null ? "?" : String.valueOf(md.getString(android.media.MediaMetadata.METADATA_KEY_ARTIST));
                String line = c.getPackageName() + ": \"" + title + "\" by " + artist
                        + (ps == null ? "" : " state=" + ps.getState() + " actions=" + ps.getActions());
                full.append(line).append('\n');
                sb.append("\n   ").append(line);
            }
            return "READABLE" + sb;
        } catch (SecurityException se) {
            return "no access yet (run the allow_listener command, then reopen)";
        } catch (Throwable t) {
            return "error " + root(t);
        }
    }

    private List<String> discoverClasses() {
        full.append("\n== BYD classes found ==\n");
        TreeSet<String> found = new TreeSet<>();
        // 1. Scan framework jars.
        TreeSet<String> jars = new TreeSet<>();
        for (String env : new String[]{"BOOTCLASSPATH", "SYSTEMSERVERCLASSPATH"}) {
            String v = System.getenv(env);
            if (v != null) jars.addAll(Arrays.asList(v.split(":")));
        }
        File fw = new File("/system/framework");
        File[] fwFiles = fw.listFiles();
        if (fwFiles != null) for (File f : fwFiles) if (f.getName().endsWith(".jar")) jars.add(f.getPath());
        for (String jar : jars) {
            try {
                @SuppressWarnings("deprecation") DexFile dex = new DexFile(jar);
                Enumeration<String> e = dex.entries();
                while (e.hasMoreElements()) {
                    String n = e.nextElement();
                    if (n.toLowerCase(Locale.ROOT).contains("bydauto")) found.add(n);
                }
            } catch (Throwable ignored) {
                // stripped jar; fall back to guessing names below
            }
        }
        full.append("scanned ").append(jars.size()).append(" framework jars, ").append(found.size()).append(" BYD classes\n");
        // 2. Guess common names.
        for (String s : SUBSYSTEMS) {
            String camel = Character.toUpperCase(s.charAt(0)) + s.substring(1);
            for (String n : new String[]{
                    "android.hardware.bydauto." + s + ".BYDAuto" + camel + "Device",
                    "android.hardware.bydauto.BYDAuto" + camel + "Device"}) {
                try {
                    Class.forName(n);
                    found.add(n);
                } catch (Throwable ignored) { }
            }
        }
        for (String n : found) full.append(n).append('\n');
        int devices = 0;
        for (String n : found) if (n.endsWith("Device")) devices++;
        summary.append("BYD classes visible: ").append(found.size()).append(" (").append(devices).append(" devices)\n\n");
        return new ArrayList<>(found);
    }

    private void probeDevice(String className) {
        full.append("\n== ").append(className).append(" ==\n");
        String shortName = className.substring(className.lastIndexOf('.') + 1);
        Object inst;
        Class<?> cls;
        try {
            cls = Class.forName(className);
            Method gi = cls.getMethod("getInstance", Context.class);
            inst = gi.invoke(null, this);
        } catch (Throwable t) {
            full.append("getInstance failed: ").append(root(t)).append('\n');
            summary.append(shortName).append(": cannot open (").append(root(t)).append(")\n");
            return;
        }
        if (inst == null) {
            summary.append(shortName).append(": getInstance returned null\n");
            return;
        }
        // Constants (feature ids etc.)
        int consts = 0;
        for (Field f : cls.getFields()) {
            if (Modifier.isStatic(f.getModifiers()) && f.getType() == int.class) {
                try {
                    full.append("  const ").append(f.getName()).append(" = ").append(f.getInt(null)).append('\n');
                    consts++;
                } catch (Throwable ignored) { }
            }
        }
        int ok = 0, denied = 0, failed = 0;
        StringBuilder interesting = new StringBuilder();
        Method[] methods = cls.getMethods();
        Arrays.sort(methods, (a, b2) -> a.getName().compareTo(b2.getName()));
        for (Method m : methods) {
            String name = m.getName();
            full.append("  method ").append(m.getReturnType().getSimpleName()).append(' ').append(name)
                    .append(Arrays.toString(m.getParameterTypes()).replace("class ", "")).append('\n');
            if (!isSafeGetter(m)) continue;
            Class<?>[] pt = m.getParameterTypes();
            int[][] argSets = pt.length == 0 ? new int[][]{{}} : new int[][]{{1}, {2}, {3}, {4}};
            for (int[] args : argSets) {
                String label = name + (args.length == 0 ? "()" : "(" + args[0] + ")");
                String result = call(inst, m, args);
                full.append("    ").append(label).append(" -> ").append(result).append('\n');
                if (result.startsWith("ERR")) {
                    if (result.contains("Security")) denied++; else failed++;
                } else {
                    ok++;
                    if (isInteresting(name)) interesting.append("   ").append(label).append(" = ").append(result).append('\n');
                }
            }
        }
        summary.append(shortName).append(": ").append(ok).append(" readings OK, ")
                .append(denied).append(" permission denied, ").append(failed).append(" failed, ")
                .append(consts).append(" constants\n").append(interesting);
    }

    // ---------- helpers ----------

    private static boolean isSafeGetter(Method m) {
        String n = m.getName();
        if (!(n.startsWith("get") || n.startsWith("is"))) return false;
        if (n.equals("getInstance") || n.equals("getClass") || n.equals("hashCode")) return false;
        if (Modifier.isStatic(m.getModifiers())) return false;
        Class<?> r = m.getReturnType();
        if (!(r.isPrimitive() || r == String.class) || r == void.class) return false;
        Class<?>[] p = m.getParameterTypes();
        return p.length == 0 || (p.length == 1 && p[0] == int.class);
    }

    private static boolean isInteresting(String name) {
        String n = name.toLowerCase(Locale.ROOT);
        for (String w : INTEREST) if (n.contains(w)) return true;
        return false;
    }

    private String call(Object inst, Method m, int[] args) {
        Future<Object> f = callExecutor.submit(() -> args.length == 0 ? m.invoke(inst) : m.invoke(inst, args[0]));
        try {
            Object o = f.get(1500, TimeUnit.MILLISECONDS);
            return String.valueOf(o);
        } catch (java.util.concurrent.TimeoutException te) {
            f.cancel(true);
            return "ERR timeout";
        } catch (Throwable t) {
            return "ERR " + root(t);
        }
    }

    private static String root(Throwable t) {
        while (t.getCause() != null) t = t.getCause();
        String s = t.getClass().getSimpleName();
        return t.getMessage() == null ? s : s + ": " + t.getMessage();
    }

    private static String getprop(String key) {
        try {
            Process p = Runtime.getRuntime().exec(new String[]{"getprop", key});
            BufferedReader r = new BufferedReader(new InputStreamReader(p.getInputStream()));
            String l = r.readLine();
            return l == null ? "" : l.trim();
        } catch (Throwable t) {
            return "";
        }
    }

    private String save() {
        try {
            File dir = getExternalFilesDir(null);
            if (dir == null) dir = getFilesDir();
            File out = new File(dir, "probe-report.txt");
            try (FileWriter w = new FileWriter(out)) {
                w.write("SUMMARY\n" + summary + "\nFULL\n" + full);
            }
            return out.getAbsolutePath();
        } catch (Throwable t) {
            return "(could not save: " + root(t) + ")";
        }
    }
}
