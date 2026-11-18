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
3. Open **Shark 6 Probe** on the car screen. Photograph the summary, or pull the full report:
   ```
   adb pull /sdcard/Android/data/au.jonty.shark6.probe/files/probe-report.txt
   ```
4. Remove it afterwards with `adb uninstall au.jonty.shark6.probe`.

## Caution
Unofficial apps may affect BYD warranty, and a BYD over-the-air update can remove sideloaded apps or close ADB access.
