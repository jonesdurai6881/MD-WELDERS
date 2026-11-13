# MD WELDERS APK Verification

## Verified debug APK

- Latest debug APK found: `E:\MD-WELDING\android\app\build\outputs\apk\debug\app-debug.apk`
- Build artifact timestamp: `2026-11-11 21:21:20`
- Verified and copied APK: `E:\MD-WELDING\release-test\MD-WELDERS-debug-verified-2026-11-11.apk`
- File size: `24,856,624` bytes
- SHA-256: `98882CD1ADC60BBC6AADA7D8CD301EC5A330CA48D718F3A76EC640BFFB1B4BCB`
- The copied APK SHA-256 matches the source APK.

## Bundle verification

- The APK's DEX contains `MdwSpeechRecognitionPlugin`.
- Its JavaScript bundle references `MdwSpeechRecognition` and calls `startRecognition({ language })` in the Capacitor-native branch.
- The native branch returns before the browser recognition fallback is selected.
- `webkitSpeechRecognition` remains in the bundle as the non-native browser fallback. The prior generic message, `Could not recognize speech. Try again or type your transaction.`, is absent.

The APK was copied and verified without rebuilding or modifying source code.
