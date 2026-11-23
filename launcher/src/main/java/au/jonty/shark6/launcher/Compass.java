package au.jonty.shark6.launcher;

import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;

/**
 * The car's heading for the wireframe (0 = north, 90 = east), from the head unit's own
 * magnetometer and gravity sensors. The screen faces the driver, so the car's nose is the
 * direction going into the screen (the device's -Z axis), flattened onto the ground.
 */
final class Compass implements SensorEventListener {
    private final SensorManager sm;
    private final Sensor mag, grav;
    private final float[] m = new float[3], g = new float[3], R = new float[9];
    private boolean haveM, haveG;
    private double heading = Double.NaN;

    Compass(Context c) {
        sm = (SensorManager) c.getSystemService(Context.SENSOR_SERVICE);
        mag = sm == null ? null : sm.getDefaultSensor(Sensor.TYPE_MAGNETIC_FIELD);
        Sensor s = sm == null ? null : sm.getDefaultSensor(Sensor.TYPE_GRAVITY);
        if (s == null && sm != null) s = sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
        grav = s;
    }

    boolean available() { return mag != null && grav != null; }

    void start() {
        if (!available()) return;
        sm.registerListener(this, mag, SensorManager.SENSOR_DELAY_UI);
        sm.registerListener(this, grav, SensorManager.SENSOR_DELAY_UI);
    }

    void stop() { if (sm != null) sm.unregisterListener(this); }

    @Override public synchronized void onSensorChanged(SensorEvent e) {
        float[] t = e.sensor == mag ? m : g;
        float k = (e.sensor == mag ? haveM : haveG) ? 0.15f : 1f;   // smooth out engine and speaker noise
        for (int i = 0; i < 3; i++) t[i] += k * (e.values[i] - t[i]);
        if (e.sensor == mag) haveM = true; else haveG = true;
        if (!haveM || !haveG || !SensorManager.getRotationMatrix(R, null, g, m)) return;
        // World vector of the device's -Z axis (into the screen = the car's nose): (east, north).
        double east = -R[2], north = -R[5];
        if (Math.hypot(east, north) < 0.2) return;          // screen lying flat: no forward direction
        double h = Math.toDegrees(Math.atan2(east, north));
        heading = (h + 360) % 360;
    }

    @Override public void onAccuracyChanged(Sensor s, int a) { }

    /** Degrees from north, or NaN before the sensors have reported. */
    synchronized double read() { return heading; }
}
