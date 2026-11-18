# Shark 6 Launcher

A custom home screen for the BYD Shark 6 (DiLink head unit), sporty design.

## Status
1. **Probe app** (`probe/`): read-only survey of what BYD's vehicle software exposes to a sideloaded app: classes, permissions, readings, home-screen options. It never sends a command to the car.
2. **Launcher** (coming next): built once the probe shows which readings and controls work.

## Installing the probe (wireless ADB, same as Sharkware)
1. Download `shark6-probe.apk` from the latest release on this repo.
2. With the laptop and car on the same Wi-Fi and ADB enabled:
   ```
   adb connect <car-ip>:5555
   adb install -r shark6-probe.apk
   ```
3. (Optional, for the now-playing check) start a song in CarPlay, then allow the probe to read media info:
   ```
   adb shell cmd notification allow_listener au.jonty.shark6.probe/au.jonty.shark6.probe.MediaListener
   ```
4. Open **Shark 6 Probe** on the car screen. Photograph the summary, or pull the full report:
   ```
   adb pull /sdcard/Android/data/au.jonty.shark6.probe/files/probe-report.txt
   ```
5. Remove it afterwards with `adb uninstall au.jonty.shark6.probe`.

## Caution
Unofficial apps may affect BYD warranty, and a BYD over-the-air update can remove sideloaded apps or close ADB access.

## Shark 6 Home (the launcher)

`launcher/` is the home screen app. The UI is the approved design (`design/sporty-home.dc.html`)
ported to plain HTML/JS in `launcher/src/main/assets/` (Preact + htm, fonts bundled, works offline),
fed live car data by `CarData.java` twice a second. BYD's header bar stays visible (not full screen).

Install (car on Wi-Fi with ADB on):

```
adb install -r shark6-home.apk
for p in STATISTIC GEARBOX BODYWORK ENGINE MOTOR; do adb shell pm grant au.jonty.shark6.launcher android.permission.BYDAUTO_${p}_COMMON; done
adb shell cmd notification allow_listener au.jonty.shark6.launcher/au.jonty.shark6.launcher.MediaListener
```

Errors from `pm grant` for permissions that aren't "dangerous" on this car are harmless.
Climate and seat buttons are live from 0.3 (`CarData.CONTROLS_ENABLED`).

Vehicle SDK loading and call encodings follow SharkHub (github.com/Peacemaker105/SharkHub, MIT).
Bundled: htm/Preact (Apache-2.0 / MIT), Barlow and Barlow Condensed (OFL-1.1), Material Symbols paths (Apache-2.0).
