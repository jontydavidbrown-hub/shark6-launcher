package au.jonty.shark6.launcher;

import android.content.Context;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.HashMap;
import java.util.Map;

import dalvik.system.PathClassLoader;

/**
 * Reads the car through BYD's vehicle SDK (android.hardware.bydauto.*).
 *
 * On the Shark 6 the SDK isn't on an app's classpath; it ships inside BYD's climate app, so we load
 * it from there. Approach and call encodings from SharkHub (github.com/Peacemaker105/SharkHub, MIT),
 * checked against our own probe on build SOC_260811_S. Never open the audio device: its background
 * thread needs a car audio permission and crashes the app.
 */
final class CarData {
    private static final String TAG = "Shark6Car";

    /** Climate and seat buttons. Switched on after live readings were confirmed on the car (0.3). */
    static final boolean CONTROLS_ENABLED = true;

    private static final String[] CLIENT_PACKAGES = {"com.byd.hvac", "com.byd.autoservice"};
    private static final String[][] DEVICES = {
            {"ac", "android.hardware.bydauto.ac.BYDAutoAcDevice"},
            {"setting", "android.hardware.bydauto.setting.BYDAutoSettingDevice"},
            {"statistic", "android.hardware.bydauto.statistic.BYDAutoStatisticDevice"},
            {"speed", "android.hardware.bydauto.speed.BYDAutoSpeedDevice"},
            {"energy", "android.hardware.bydauto.energy.BYDAutoEnergyDevice"},
            {"tyre", "android.hardware.bydauto.tyre.BYDAutoTyreDevice"},
            {"gearbox", "android.hardware.bydauto.gearbox.BYDAutoGearboxDevice"},
            {"engine", "android.hardware.bydauto.engine.BYDAutoEngineDevice"},
            {"motor", "android.hardware.bydauto.motor.BYDAutoMotorDevice"},
            {"instrument", "android.hardware.bydauto.instrument.BYDAutoInstrumentDevice"},
            {"light", "android.hardware.bydauto.light.BYDAutoLightDevice"},
    };

    // AC constants (SharkHub's Byd object, confirmed from the car's own constants).
    private static final int SOURCE_UI = 0, UNIT_C = 1, ON = 1, OFF = 0;
    private static final int ZONE_BOTH = 0, ZONE_DRIVER = 1, ZONE_PASSENGER = 2, ZONE_OUTSIDE = 4;
    private static final int CTRL_AUTO = 0, CTRL_MANUAL = 1, DEFROST_FRONT = 1;

    private final Context ctx;
    private final Map<String, Object> devices = new HashMap<>();
    private final Map<String, Method> methods = java.util.Collections.synchronizedMap(new HashMap<>());
    private final StringBuilder openLog = new StringBuilder();
    private boolean opened;

    CarData(Context ctx) { this.ctx = ctx.getApplicationContext(); }

    synchronized boolean open() {
        if (opened) return !devices.isEmpty();
        opened = true;
        ClassLoader loader = null;
        for (String pkg : CLIENT_PACKAGES) {
            try {
                String apk = ctx.getPackageManager().getApplicationInfo(pkg, 0).sourceDir;
                loader = new PathClassLoader(apk, ctx.getClassLoader());
                openLog.append("sdk from ").append(pkg).append('\n');
                break;
            } catch (Throwable ignored) { }
        }
        if (loader == null) {
            openLog.append("no BYD client package\n");
            return false;
        }
        for (String[] d : DEVICES) {
            try {
                Class<?> c = Class.forName(d[1], true, loader);
                Object inst = c.getMethod("getInstance", Context.class).invoke(null, ctx);
                if (inst != null) devices.put(d[0], inst);
                openLog.append(d[0]).append(": ok\n");
            } catch (Throwable t) {
                openLog.append(d[0]).append(": ").append(root(t)).append('\n');
            }
        }
        Log.i(TAG, openLog.toString());
        return !devices.isEmpty();
    }

    String openReport() { return openLog.toString(); }

    /** Call an int-argument method on a device; null if the device or method isn't there or it throws. */
    private Object call(String device, String name, int... args) {
        Object dev = devices.get(device);
        if (dev == null) return null;
        String key = device + "." + name + "/" + args.length;
        Method m = methods.get(key);
        if (m == null && !methods.containsKey(key)) {
            for (Method cand : dev.getClass().getMethods()) {
                if (!cand.getName().equals(name) || Modifier.isStatic(cand.getModifiers())) continue;
                Class<?>[] p = cand.getParameterTypes();
                if (p.length != args.length) continue;
                boolean allInt = true;
                for (Class<?> x : p) if (x != int.class) { allInt = false; break; }
                if (allInt) { m = cand; break; }
            }
            methods.put(key, m);
        }
        if (m == null) return null;
        try {
            Object[] boxed = new Object[args.length];
            for (int i = 0; i < args.length; i++) boxed[i] = args[i];
            return m.invoke(dev, boxed);
        } catch (Throwable t) {
            return null;
        }
    }

    /** Speed, gear and indicators: cheap enough to read ten times a second for a live speedo. */
    double[] fast() {
        if (!open()) return null;
        Double sp = num("speed", "getCurrentSpeed"), g = num("gearbox", "getGearboxAutoModeLevel");
        return new double[] { sp == null ? -1 : sp, g == null ? -1 : g, turn() };
    }

    /**
     * Indicators: 0 off, 1 left, 2 right, 3 hazards. light.getTurnLightFlashState() reads 2/3 for
     * left, 4/5 for right and 6/7 for hazards (as Overdrive, MIT, uses it); getLightStatus(4 left,
     * 5 right) is the fallback.
     */
    private AutoSvc auto;
    String turnSource() { return auto == null ? "sdk" : auto.source + " · " + auto.last; }

    private int turn() {
        if (auto == null) auto = new AutoSvc(ctx);
        int t = auto.turn();
        if (t >= 0) return t;
        Double f = num("light", "getTurnLightFlashState");
        if (f != null && f >= 2 && f <= 7) {
            int v = f.intValue();
            return v <= 3 ? 1 : v <= 5 ? 2 : 3;
        }
        Double l = num("light", "getLightStatus", 4), r = num("light", "getLightStatus", 5);
        boolean left = l != null && l.intValue() == 1, right = r != null && r.intValue() == 1;
        return left && right ? 3 : left ? 1 : right ? 2 : 0;
    }

    private Double num(String device, String name, int... args) {
        Object v = call(device, name, args);
        return v instanceof Number ? ((Number) v).doubleValue() : null;
    }

    private static void put(JSONObject o, String k, Double v, double min, double max) {
        if (v == null || v.isNaN() || v < min || v > max) return;
        try { o.put(k, v); } catch (Exception ignored) { }
    }

    /** One snapshot of everything the home screen shows. Blocking: call off the main thread. */
    JSONObject read() {
        JSONObject o = new JSONObject();
        try {
            o.put("ok", !devices.isEmpty());
            // Range and energy (statistic needs BYDAUTO_STATISTIC_COMMON, granted with adb).
            put(o, "battPct", num("statistic", "getElecPercentageValue"), 0, 100);
            put(o, "fuelPct", num("statistic", "getFuelPercentageValue"), 0, 100);
            put(o, "evRange", num("statistic", "getElecDrivingRangeValue"), 0, 2000);
            put(o, "fuelRange", num("statistic", "getFuelDrivingRangeValue"), 0, 3000);
            put(o, "totalRange", num("statistic", "getDrivingRangeAll"), 0, 4000);
            // Trip: the cluster's trip meter (statistic MILEAGE_ONE = 0); this-drive distance as a fallback.
            Double trip1 = num("statistic", "getMileageNumber", 0);
            put(o, "tripKm", trip1 != null && trip1 > 0 ? trip1 : num("statistic", "getCurrentTripMileage"), 0, 100000);
            put(o, "trip2Km", num("statistic", "getMileageNumber", 1), 0, 1000000);
            put(o, "tripKwh", num("statistic", "getCurrentTripElec"), 0, 100000);
            put(o, "tripFuel", num("statistic", "getCurrentTripFuel"), 0, 100000);
            put(o, "odo", num("statistic", "getTotalMileageValue"), 0, 10000000);
            put(o, "avgElec", num("statistic", "getTotalElecConPHMValue"), 0, 100);
            put(o, "avgFuel", num("statistic", "getTotalFuelConPHMValue"), 0, 40);
            // Driving
            put(o, "speed", num("speed", "getCurrentSpeed"), 0, 300);
            put(o, "gear", num("gearbox", "getGearboxAutoModeLevel"), 1, 6);
            put(o, "energyMode", num("energy", "getEnergyMode"), 0, 10);
            // Drive mode: setting.getDriveMode() uses 1 Normal, 2 Eco, 3 Sport, 4 Snow, 5 Mud, 6 Sand
            // (read 3 in Sport). energy.getOperationMode() is a different scale (2 = Sport), so it misread as Eco.
            Double dm = num("setting", "getDriveMode");
            if (dm == null || dm < 1) {
                Double op = num("energy", "getOperationMode"); // 1 Economy, 2 Sport, 3 Normal
                dm = op == null ? null : op == 1 ? 2.0 : op == 2 ? 3.0 : op == 3 ? 1.0 : null;
            }
            put(o, "opMode", dm, 1, 20);
            put(o, "motorKw", num("motor", "getMotorPower"), -400, 400);
            put(o, "engineKw", num("engine", "getEnginePower"), 0, 400);
            // Tyres: psi x10 on this car (ByType), else kPa.
            JSONArray tyres = new JSONArray(), states = new JSONArray();
            for (int area = 1; area <= 4; area++) {
                Double t = num("tyre", "getTyrePressureValueByType", area);
                Double psi = null;
                if (t != null && t / 10 >= 15 && t / 10 <= 90) psi = t / 10;
                else {
                    Double kpa = num("tyre", "getTyrePressureValue", area);
                    if (kpa != null && kpa > 50 && kpa < 600) psi = kpa * 0.1450377;
                }
                tyres.put(psi == null ? JSONObject.NULL : Math.round(psi * 10) / 10.0);
                Double st = num("tyre", "getTyrePressureState", area);
                states.put(st == null ? 0 : st.intValue());
            }
            if (devices.containsKey("tyre")) { o.put("tyres", tyres); o.put("tyreStates", states); }
            // Climate
            put(o, "outside", num("ac", "getTemprature", ZONE_OUTSIDE), -40, 60);
            put(o, "drvTemp", num("ac", "getTemprature", ZONE_DRIVER), 17, 33);
            put(o, "pasTemp", num("ac", "getTemprature", ZONE_PASSENGER), 17, 33);
            put(o, "fan", num("ac", "getAcWindLevel"), 0, 7);
            Double power = num("ac", "getAcStartState");
            Double comp = num("ac", "getAcCompressorMode");
            Double ctrl = num("ac", "getAcControlMode");
            Double defrost = num("ac", "getAcDefrostState", DEFROST_FRONT);
            if (power != null) o.put("acPower", power.intValue() == ON ? 1 : 0);
            if (comp != null) o.put("compressor", comp.intValue() == ON ? 1 : 0);
            if (ctrl != null) o.put("auto", ctrl.intValue() == CTRL_AUTO ? 1 : 0);
            if (defrost != null) o.put("demist", defrost.intValue() == ON ? 1 : 0);
            Double split = num("ac", "getAcTemperatureControlMode");
            if (split != null) o.put("dual", split.intValue() == ON ? 1 : 0);
            // Seats: OFF=1, LOW=2, HIGH=3 on the car; 0 means not reported.
            JSONObject seats = new JSONObject();
            seats.put("drvHeat", seatLevel(num("setting", "getSeatHeatingState", 1)));
            seats.put("drvVent", seatLevel(num("setting", "getSeatVentilatingState", 1)));
            // Passenger seat: this build answers zone 2 with 0, and reports the passenger seat through
            // the *NotL1PState getters instead (probe 0.7, passenger vent on: 1 -> 3).
            Double ph = num("setting", "getSeatHeatingState", 2), pv = num("setting", "getSeatVentilatingState", 2);
            if (ph == null || ph < 1) ph = num("setting", "getSeatHeatingNotL1PState");
            if (pv == null || pv < 1) pv = num("setting", "getSeatVentilatingNotL1PState");
            seats.put("pasHeat", seatLevel(ph));
            seats.put("pasVent", seatLevel(pv));
            o.put("seats", seats);
        } catch (Exception e) {
            Log.w(TAG, "read failed", e);
        }
        return o;
    }

    private static int seatLevel(Double code) {
        if (code == null) return 0;
        int c = code.intValue();
        return c >= 1 && c <= 3 ? c - 1 : 0;
    }

    /** Climate and seat commands. Returns "ok", "disabled", or why the car refused. */
    String command(String name, JSONObject a) {
        if (!CONTROLS_ENABLED) return "disabled";
        if (!open()) return "no car connection";
        Object r;
        switch (name) {
            case "temp": {
                // Synced (zones joined): every temp tap sets both sides and the zones stay joined.
                // Split: each side sets only its own zone. Only the SYNC button changes the mode.
                int t = Math.max(17, Math.min(33, a.optInt("value", 21)));
                boolean separate;
                if (a.has("both")) separate = !a.optBoolean("both");
                else { Double split = num("ac", "getAcTemperatureControlMode"); separate = split != null && split.intValue() == ON; }
                int target = !separate ? ZONE_BOTH
                        : a.optInt("zone", ZONE_DRIVER) == ZONE_PASSENGER ? ZONE_PASSENGER : ZONE_DRIVER;
                r = call("ac", "setAcTemperature", target, t, SOURCE_UI, UNIT_C);
                break;
            }
            case "sync":
                // Synced = zones joined (control mode off); unsynced = separate driver/passenger temps.
                r = call("ac", "setAcTemperatureControlMode", SOURCE_UI, a.optBoolean("on") ? OFF : ON);
                // Turning sync on: bring the passenger side to the driver's temperature too.
                if (a.optBoolean("on") && a.has("value"))
                    call("ac", "setAcTemperature", ZONE_BOTH, Math.max(17, Math.min(33, a.optInt("value", 21))), SOURCE_UI, UNIT_C);
                break;
            case "fan":
                r = call("ac", "setAcWindLevel", SOURCE_UI, Math.max(1, Math.min(7, a.optInt("level", 1))));
                break;
            case "ac":
                r = call("ac", "setAcCompressorMode", SOURCE_UI, a.optBoolean("on") ? ON : OFF);
                break;
            case "auto":
                r = call("ac", "setAcControlMode", SOURCE_UI, a.optBoolean("on") ? CTRL_AUTO : CTRL_MANUAL);
                break;
            case "demist":
                r = call("ac", "setAcDefrostState", SOURCE_UI, DEFROST_FRONT, a.optBoolean("on") ? ON : OFF);
                break;
            case "seatHeat":
                r = call("setting", "setSeatHeatingState", a.optInt("zone", 1), Math.max(0, Math.min(2, a.optInt("level"))) + 1);
                break;
            case "seatVent":
                r = call("setting", "setSeatVentilatingState", a.optInt("zone", 1), Math.max(0, Math.min(2, a.optInt("level"))) + 1);
                break;
            case "resetTrip":
                // Instrument device: resetMileage(MILEAGE_ONE=1 | MILEAGE_TWO=2, MILEAGE_RESET=1).
                r = call("instrument", "resetMileage", "B".equals(a.optString("trip")) ? 2 : 1, 1);
                if (r == null) return "trip reset not available";
                break;
            default:
                return "unknown command";
        }
        if (r instanceof Integer && (Integer) r < 0) return "code " + r;
        return "ok";
    }

    private static String root(Throwable t) {
        while (t.getCause() != null) t = t.getCause();
        return t.getClass().getSimpleName() + (t.getMessage() == null ? "" : ": " + t.getMessage());
    }
}
