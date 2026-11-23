package au.jonty.shark6.launcher;

import android.content.Context;
import android.content.SharedPreferences;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Bundle;
import android.os.Looper;

/**
 * The car's heading for the wireframe (0 = north, 90 = east).
 * 1. GPS bearing while driving (the head unit's own GPS). The last one is remembered, so a parked
 *    car still faces the way it was last driven.
 * 2. Otherwise the head unit's magnetometer, if it has one (0.66 showed the Shark's doesn't report).
 */
final class Compass implements SensorEventListener, LocationListener {
    private final Context ctx;
    private final SensorManager sm;
    private final Sensor mag, grav;
    private final SharedPreferences prefs;
    private final float[] m = new float[3], g = new float[3], R = new float[9];
    private boolean haveM, haveG;
    private double magHeading = Double.NaN, gpsHeading;
    private long gpsAt;
    private volatile String state = "not started";

    Compass(Context c) {
        ctx = c;
        sm = (SensorManager) c.getSystemService(Context.SENSOR_SERVICE);
        mag = sm == null ? null : sm.getDefaultSensor(Sensor.TYPE_MAGNETIC_FIELD);
        Sensor s = sm == null ? null : sm.getDefaultSensor(Sensor.TYPE_GRAVITY);
        if (s == null && sm != null) s = sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
        grav = s;
        prefs = c.getSharedPreferences("compass", Context.MODE_PRIVATE);
        gpsHeading = prefs.getFloat("gps", Float.NaN);
    }

    boolean available() { return true; }

    void start() {
        if (mag != null && grav != null) {
            sm.registerListener(this, mag, SensorManager.SENSOR_DELAY_UI);
            sm.registerListener(this, grav, SensorManager.SENSOR_DELAY_UI);
        }
        try {
            LocationManager lm = (LocationManager) ctx.getSystemService(Context.LOCATION_SERVICE);
            if (lm != null && lm.getAllProviders().contains(LocationManager.GPS_PROVIDER)) {
                lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000, 0, this, Looper.getMainLooper());
                state = "gps listening";
            } else state = "no gps provider";
        } catch (SecurityException e) {
            state = "no location permission yet";
        } catch (Throwable t) {
            state = "gps: " + t.getMessage();
        }
    }

    void stop() {
        if (sm != null) sm.unregisterListener(this);
        try { ((LocationManager) ctx.getSystemService(Context.LOCATION_SERVICE)).removeUpdates(this); } catch (Throwable ignored) { }
    }

    @Override public synchronized void onLocationChanged(Location l) {
        // Bearing is only meaningful while moving (above ~8 km/h).
        if (l == null || !l.hasBearing() || !l.hasSpeed() || l.getSpeed() < 2.2f) return;
        gpsHeading = l.getBearing();
        gpsAt = System.currentTimeMillis();
        state = "gps bearing";
        prefs.edit().putFloat("gps", (float) gpsHeading).apply();
    }
    @Override public void onStatusChanged(String p, int s, Bundle b) { }
    @Override public void onProviderEnabled(String p) { }
    @Override public void onProviderDisabled(String p) { }

    @Override public synchronized void onSensorChanged(SensorEvent e) {
        float[] t = e.sensor == mag ? m : g;
        float k = (e.sensor == mag ? haveM : haveG) ? 0.15f : 1f;
        for (int i = 0; i < 3; i++) t[i] += k * (e.values[i] - t[i]);
        if (e.sensor == mag) haveM = true; else haveG = true;
        if (!haveM || !haveG || !SensorManager.getRotationMatrix(R, null, g, m)) return;
        // The screen faces the driver: the car's nose is into the screen (device -Z).
        double east = -R[2], north = -R[5];
        if (Math.hypot(east, north) < 0.2) return;
        magHeading = (Math.toDegrees(Math.atan2(east, north)) + 360) % 360;
    }

    @Override public void onAccuracyChanged(Sensor s, int a) { }

    /** Degrees from north, or NaN when nothing has reported yet. */
    synchronized double read() {
        if (!Double.isNaN(gpsHeading)) return gpsHeading;
        return magHeading;
    }

    String report() {
        return "compass: " + state + ", gps " + (Double.isNaN(gpsHeading) ? "-" : Math.round(gpsHeading) + "°" + (gpsAt == 0 ? " (remembered)" : ""))
                + ", magnetometer " + (mag == null ? "none" : Double.isNaN(magHeading) ? "silent" : Math.round(magHeading) + "°");
    }
}
