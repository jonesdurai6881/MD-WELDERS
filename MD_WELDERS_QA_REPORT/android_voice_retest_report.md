# MD WELDERS Android Voice Retest

## Result

The Tamil voice failure was reproduced on the connected Infinix phone. The app displayed:

> Could not recognize speech. Try again or type your transaction.

The installed app is **not the latest local debug build**. Its JavaScript bundle is an older build that still invokes the browser Web Speech API and does not invoke `MdwSpeechRecognition`. Therefore this retest does not exercise the native integration in the latest APK.

## Installed APK verification

- Device: `120703144F020601` (`Infinix X6871`)
- Package: `com.mdwelders.business`
- Installed APK path: `/data/app/~~MsNfHJflAiSfQ6cMEFs4gg==/com.mdwelders.business-pv8tQtey6PGvfCXKCK_qqA==/base.apk`
- Installed package metadata: version code `1`, version name `0.1.0`, last update `2026-11-11 20:21:36`
- Installed APK size: `24,728,452` bytes; SHA-256: `F10DA0700075906BC5ED4D08D18AAB9F52AE20BDCA208E488C77F5BF251C5216`
- Local debug APK: `android/app/build/outputs/apk/debug/app-debug.apk`, timestamp `2026-11-11 21:21:20`, size `24,856,624` bytes; SHA-256: `98882CD1ADC60BBC6AADA7D8CD301EC5A330CA48D718F3A76EC640BFFB1B4BCB`
- The installed APK is a different binary from the local latest build.

Both APKs contain the native plugin class. The latest local APK's JavaScript assets reference `MdwSpeechRecognition`; the installed APK's `assets/public/assets/index-D9Ca5VBl.js` does not. Its installed JS bundle contains the legacy generic error and `webkitSpeechRecognition`, but no `MdwSpeechRecognition` reference or `voice-field` integration.

## Voice test and Logcat

- Cleared the device Logcat buffer, started a `threadtime` capture, then the user tapped Speak and spoke the Tamil test sentence. The generic error appeared.
- Capture interval: approximately `2026-11-11 21:30:57`–`21:31:20` (device log timestamps).
- The capture contained 893 lines. There were no entries tagged with the app package name, Chromium/WebView, `SpeechRecognizer`, or `RecognitionService` associated with the attempt. The two speech/error-pattern matches were unrelated Facebook networking output.
- No transaction was saved. No source was modified, and the app was not rebuilt or reinstalled.

## Exact failure point and error code

The installed APK's JavaScript contains this legacy flow:

```text
const s = window.SpeechRecognition || window.webkitSpeechRecognition;
const t = new s();
...
t.onerror = () => st("Could not recognize speech. Try again or type your transaction.", true);
t.start();
```

The `onerror` handler ignores its event argument, so it discards the browser's actual recognition error. The handler also bypasses the native Capacitor plugin path. Consequently:

- The native `MdwSpeechRecognitionPlugin.startRecognition()` path was **not invoked by the installed JS bundle**.
- Android `SpeechRecognizer.onError()` did not produce an observable callback/error code for this test.
- **Exact Android recognition error name/code: unavailable; no native recognition request occurred.**
- The exact failure is the old installed web bundle's generic `SpeechRecognition.onerror` handling, not a confirmed native recognizer failure.

The current source `MainActivity` registers `MdwSpeechRecognitionPlugin` with `registerPlugin(MdwSpeechRecognitionPlugin.class)`, and the latest local APK contains the plugin. Registration alone does not make the old installed web bundle call it.

## Conclusion

The tested installation is stale relative to the latest local debug APK. Its old web assets explain the generic message and prevent this retest from diagnosing the native recognition service. The latest native path remains untested on-device. Installing the latest APK would be required to test that path, but was intentionally not done per instruction.
