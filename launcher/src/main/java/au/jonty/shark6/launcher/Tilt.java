package au.jonty.shark6.launcher;

import android.content.Context;
import android.content.SharedPreferences;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;

/**
 * Pitch and roll for the off-road view, from the head unit's own gravity sensor. The screen is
 * fixed to the dash, so its readings follow the car. "Zero" stores the reading on flat ground as
 * the reference (done automatically the first time, and again whenever you hold the terrain tile).
 */
final class Tilt implements SensorEventListener {
    private final SensorManager sm;
    private final Sensor sensor;
    private final boolean raw;            // accelerometer instead of gravity: smooth it ourselves
    private final SharedPreferences prefs;
    private final float[] g = new float[3];
    private boolean have;
    private float bx, by, bz;
    private boolean based;

    Tilt(Context c) {
        sm = (SensorManager) c.getSystemService(Context.SENSOR_SERVICE);
        Sensor s = sm == null ? null : sm.getDefaultSensor(Sensor.TYPE_GRAVITY);
        raw = s == null;
        if (s == null && sm != null) s = sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
        sensor = s;
        prefs = c.getSharedPreferences("tilt", Context.MODE_PRIVATE);
        based = prefs.contains("bx");
        bx = prefs.getFloat("bx", 0); by = prefs.getFloat("by", 0); bz = prefs.getFloat("bz", 0);
    }

    boolean available() { return sensor != null; }

    void start() { if (sensor != null) sm.registerListener(this, sensor, SensorManager.SENSOR_DELAY_UI); }

    void stop() { if (sensor != null) sm.unregisterListener(this); }

    @Override public synchronized void onSensorChanged(SensorEvent e) {
        float k = raw && have ? 0.1f : 1f;
        for (int i = 0; i < 3; i++) g[i] += k * (e.values[i] - g[i]);
        have = true;
        if (!based) zero();
    }

    @Override public void onAccuracyChanged(Sensor s, int a) { }

    /** Take the current reading as level. */
    synchronized void zero() {
        if (!have) return;
        bx = g[0]; by = g[1]; bz = g[2];
        based = true;
        prefs.edit().putFloat("bx", bx).putFloat("by", by).putFloat("bz", bz).apply();
    }

    /** {pitch, roll} in degrees: nose up and right side down are positive. Null with no sensor yet. */
    synchronized double[] read() {
        if (!have || !based) return null;
        double pitch = Math.toDegrees(Math.atan2(bz, by) - Math.atan2(g[2], g[1]));
        double roll = Math.toDegrees(Math.atan2(bx, Math.hypot(by, bz)) - Math.atan2(g[0], Math.hypot(g[1], g[2])));
        return new double[] { wrap(pitch), wrap(roll) };
    }

    private static double wrap(double d) {
        while (d > 180) d -= 360;
        while (d < -180) d += 360;
        return d;
    }
}
