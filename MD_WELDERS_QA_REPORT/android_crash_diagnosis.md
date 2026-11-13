# MD WELDERS Android Startup Crash Diagnosis

## Result

- **Application package ID:** `com.mdwelders.business` (from `android/app/build.gradle`, `applicationId`)
- **ADB device:** `120703144F020601`
- **Launch result:** The installed app's `com.mdwelders.business/.MainActivity` crashed during startup. The app process was no longer running after log capture.
- **Root cause shown by the device:** `MainActivity` starts an `AppCompatActivity` without a `Theme.AppCompat` theme (or descendant). The exception is thrown while `BridgeActivity.onCreate` calls `setContentView`.

## Capture procedure

Cleared existing logs with `adb logcat -c`, launched the installed app with:

```text
adb shell monkey -p com.mdwelders.business -c android.intent.category.LAUNCHER 1
```

Captured device Logcat immediately afterward. The fatal exception occurred at `2026-11-11 20:15:50.731` and was logged again at `20:15:55.012` with the same cause.

## Relevant device log

```text
11-11 20:15:50.731 13907 13907 E AndroidRuntime: FATAL EXCEPTION: main
11-11 20:15:50.731 13907 13907 E AndroidRuntime: Process: com.mdwelders.business, PID: 13907
11-11 20:15:50.731 13907 13907 E AndroidRuntime: java.lang.RuntimeException: Unable to start activity ComponentInfo{com.mdwelders.business/com.mdwelders.business.MainActivity}: java.lang.IllegalStateException: You need to use a Theme.AppCompat theme (or descendant) with this activity.
11-11 20:15:50.731 13907 13907 E AndroidRuntime: Caused by: java.lang.IllegalStateException: You need to use a Theme.AppCompat theme (or descendant) with this activity.
11-11 20:15:50.731 13907 13907 E AndroidRuntime:     at androidx.appcompat.app.AppCompatDelegateImpl.createSubDecor(AppCompatDelegateImpl.java:902)
11-11 20:15:50.731 13907 13907 E AndroidRuntime:     at androidx.appcompat.app.AppCompatDelegateImpl.ensureSubDecor(AppCompatDelegateImpl.java:865)
11-11 20:15:50.731 13907 13907 E AndroidRuntime:     at androidx.appcompat.app.AppCompatDelegateImpl.setContentView(AppCompatDelegateImpl.java:748)
11-11 20:15:50.731 13907 13907 E AndroidRuntime:     at androidx.appcompat.app.AppCompatActivity.setContentView(AppCompatActivity.java:197)
11-11 20:15:50.731 13907 13907 E AndroidRuntime:     at com.getcapacitor.BridgeActivity.onCreate(BridgeActivity.java:30)
11-11 20:15:50.731 13907 13907 E AndroidRuntime:     at com.mdwelders.business.MainActivity.onCreate(MainActivity.java:10)
11-11 20:15:50.754 1727 2819 W ActivityTaskManager: Force finishing activity com.mdwelders.business/.MainActivity
11-11 20:15:50.792 1727 2911 I ActivityManager: Process com.mdwelders.business (pid 13907) has died: fg TOP
```

## Chromium and Capacitor log check

No separate Chromium or Capacitor error entries appeared in the captured logs. Capacitor's `BridgeActivity.onCreate` appears in the fatal stack trace above; it is where the incompatible theme error surfaces.

No source files were changed; the app was not rebuilt, reinstalled, or uninstalled.
