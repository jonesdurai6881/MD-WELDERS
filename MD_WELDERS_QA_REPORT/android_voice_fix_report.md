# MD WELDERS Android Voice Recognition Fix

## Changes

- The Assistant message field already receives a `voice-field` microphone control. Final speech transcripts for that field now enter the existing `sendAssistantMessage()` flow, which uses the existing text parser to prepare a transaction draft.
- Drafts still require the existing **Confirm & save** action. Voice input never invokes confirmation or writes a transaction directly.
- Android now declares visibility for `android.speech.RecognitionService`, required for Android 11+ package queries used by `SpeechRecognizer.isRecognitionAvailable()`.
- The native plugin continues to request `RECORD_AUDIO` through its Capacitor permission alias. Native errors now include Android's error name, numeric code, and a specific description.
- Native listeners are registered incrementally and removed on completion/failure. Stop timeout cancels the recognizer; the native recognizer is also destroyed on errors, results, start/stop failures, and plugin teardown.
- Tamil (`ta-IN`) and Indian English (`en-IN`) continue to be selected through the Assistant language control and passed to native recognition.
- Text-entry parsing and explicit transaction confirmation remain unchanged.

## Validation and build

- **Frontend tests:** 18 passed, 0 failed. Includes voice error cleanup, Tamil/English locale forwarding, transcript delivery, and the existing assistant draft/confirmation tests.
- **Web build:** Vite production build completed.
- **Capacitor sync:** Android assets synced; the new bundle contains the native voice integration and no longer contains the legacy Assistant `voice-input` handler.
- **Debug APK:** Gradle `assembleDebug` succeeded.
- **APK path:** `android/app/build/outputs/apk/debug/app-debug.apk`
- **Physical voice test:** Not performed on this APK. Voice recognition is **not claimed as working** until a spoken test succeeds on a real Android device.

## Physical-device test steps

1. Install/update the debug APK on the phone: `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`.
2. Launch MD WELDERS and open **Assistant**.
3. If prompted, grant microphone permission. Do not clear app data.
4. Select Tamil, tap the microphone beside the Message field, and say: **“இன்று 1 ரூபாய் செலவு”**.
5. Verify the recognized text is submitted to the assistant and a review draft appears. Tap **Discard**; do not tap **Confirm & save**.
6. Repeat with **English / Tanglish (en-IN)** and say: **“expense 1 rupee for test materials”**. Verify the draft, then tap **Discard**.
7. Test with the phone out of a call and without another app using the microphone. If recognition fails, collect `adb logcat -c` before the attempt and `adb logcat -d -v threadtime` immediately afterward; the app should now show the specific native recognition error.

These are disposable test-expense phrases, not salary transactions. No transaction was saved during this work.

## Modified files

### Source and tests

- `frontend/src/main.js`
- `frontend/src/voice.js`
- `tests/voice.test.js`
- `android/app/src/main/AndroidManifest.xml`
- `android/app/src/main/java/com/mdwelders/business/MdwSpeechRecognitionPlugin.java`

### Generated web and synced Android assets

- `frontend/dist/index.html`
- `frontend/dist/assets/index-BWMsuM4y.js`
- `frontend/dist/assets/index-DaEuTRiw.css`
- `frontend/dist/assets/web-DkAyNeqQ.js`
- `android/app/src/main/assets/capacitor.config.json`
- `android/app/src/main/assets/public/index.html`
- `android/app/src/main/assets/public/assets/index-BWMsuM4y.js`
- `android/app/src/main/assets/public/assets/index-DaEuTRiw.css`
- `android/app/src/main/assets/public/assets/web-DkAyNeqQ.js`
- The prior hashed bundle `android/app/src/main/assets/public/assets/index-D9Ca5VBl.js` was removed by Capacitor sync.
- `android/app/build/outputs/apk/debug/app-debug.apk`
- `MD_WELDERS_QA_REPORT/android_voice_fix_report.md` (this report)
