# MD Welders Android Device Validation

**Validation date:** 2026-11-11
**Scope:** Task 1 only — real-device checks for the existing debug APK.
**Outcome:** Physical-device validation is **BLOCKED** because ADB found no connected Android device. No installation, launch, or device behavior is claimed as tested.

## APK and configuration inspected

- APK exists: `android/app/build/outputs/apk/debug/app-debug.apk` (24,831,443 bytes; last modified 2026-11-07 04:57:57).
- APK output metadata identifies package `com.mdwelders.business`, debug variant, version `0.1.0` (version code 1), and minimum SDK 23.
- APK SHA-256: `4DB679B842C6892D2F9B7CFEB6F2D8E502DCDBF9DDA9E9424F443B634103D2D4`.
- `adb devices -l` returned an empty device list. The ADB daemon started; no device was available for testing.
- The Android manifest declares `INTERNET`, `ACCESS_NETWORK_STATE`, and `RECORD_AUDIO`; microphone hardware is optional. Runtime permission prompting/grant behavior is not established by the manifest.
- The app uses Capacitor `BridgeActivity` and includes the Capacitor SQLite plugin. This configuration does not establish that SQLite works on a device.
- Prior QA documentation says the app has no local login/registration UI. This was not re-tested on a device.

## Results

| Check | Result | Actual evidence / limitation |
|---|---|---|
| 1. APK installation | **BLOCKED** | APK exists, but no device is connected; install state is unknown. |
| 2. Application launch | **BLOCKED** | No device available to launch the app. |
| 3. Login and navigation | **BLOCKED** | No device available. Prior QA reports no local login/registration flow; device navigation remains unverified. |
| 4. Local database persistence | **BLOCKED** | SQLite plugin is configured, but no on-device record could be created or checked. |
| 5. Restart and data retention | **BLOCKED** | No device available to force-stop/relaunch and inspect retained data. |
| 6. Back button behavior | **BLOCKED** | No device available to exercise hardware/system Back behavior. |
| 7. Microphone permissions | **BLOCKED** | `RECORD_AUDIO` is declared; runtime permission prompt, grant/deny, and microphone behavior were not exercised. |
| 8. Network disconnection behavior | **BLOCKED** | No device available to toggle network/Airplane mode and check offline operation. |
| 9. Application crashes | **BLOCKED** | No app process was launched; runtime stability and crash logs are unknown. |

## Manual device checklist

Run these checks when an Android device or emulator is connected and authorized for ADB. Replace `<DEVICE_SERIAL>` with the serial reported by `adb devices -l`.

1. **Install:** Run `adb -s <DEVICE_SERIAL> install -r "E:\MD-WELDING\android\app\build\outputs\apk\debug\app-debug.apk"`. Confirm ADB reports success and the app appears in the launcher.
2. **Launch:** Run `adb -s <DEVICE_SERIAL> shell monkey -p com.mdwelders.business 1`. Confirm the app opens to a usable screen and remains responsive.
3. **Login/navigation:** Check whether a login screen is shown; the current QA record says local login is not implemented. Navigate through the app’s available screens and confirm each opens and returns without a blank screen or hang. Record the observed screens; do not treat absent login as a successful login test.
4. **Local persistence:** With network disabled, create one clearly identifiable test record (for example, employee `QA Device Persistence`), save it, leave the screen, return, and confirm the record remains visible.
5. **Restart/data retention:** Run `adb -s <DEVICE_SERIAL> shell am force-stop com.mdwelders.business`, relaunch using the launch command above, and confirm the same test record remains. Do not clear app data or uninstall before verifying.
6. **Back button:** Use the device/system Back action from a form, a nested/detail screen, and the main screen. Confirm it dismisses the relevant form/detail or follows the app’s intended navigation without unexpectedly exiting or losing saved data.
7. **Microphone permission:** Open the assistant’s voice-input control. Record whether Android prompts for microphone access. Test allow and deny paths; after denial, confirm the app remains usable and reports/handles unavailable speech input. Revisit app permission settings if needed to test changing the decision.
8. **Network disconnection:** Enable Airplane mode (or disable Wi-Fi and mobile data), confirm the app remains usable, and verify local record creation/readback. Confirm sync reports offline/unavailable rather than losing local data. Re-enable networking afterward.
9. **Crash check:** Exercise the above flows while observing for app closure, Android “not responding” dialogs, or unexpected restart. After reproducing any issue, collect `adb -s <DEVICE_SERIAL> logcat -d -t 2000` and record the time, steps, and relevant crash output. A clean run should be recorded only after the full checklist is exercised.

## Stop condition

No device checks were run because no device was connected. No files affecting application behavior were changed. Previously completed QA suites/builds were not repeated.
