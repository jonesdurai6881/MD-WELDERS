# MD WELDERS Android Voice Input Diagnosis

## Root cause

The reported text is a generic fallback from the **legacy JavaScript bundle packaged in the installed app**, not the speech recognizer's actual error. The installed asset `android/app/src/main/assets/public/assets/index-D9Ca5VBl.js` wires the assistant's `Speak` button to `nf()`, which constructs `window.SpeechRecognition` / `window.webkitSpeechRecognition`. Its `onerror` callback ignores the error event and always displays:

```js
Could not recognize speech. Try again or type your transaction.
```

Consequently, the visible message does not reveal whether the recognizer failed due to silence, network, audio capture, language, or another service error.

The current frontend source follows a different path: `frontend/src/main.js` handles `voice-field` and `frontend/src/voice.js` selects the native `MdwSpeechRecognition` Capacitor plugin on Android. That path is not present in the installed bundle used by the assistant's `Speak` control. Thus the installed app bypasses the native recognition path and masks the Web Speech API error. This is the confirmed app-side cause of the reported generic failure; the specific underlying recognizer error cannot be recovered from this bundle's callback.

## Code and configuration inspected

- **Microphone button:** The installed assistant UI exposes `data-action="voice-input"` and `id="voiceBtn"`; its handler calls `nf()`. The current source instead routes `voice-field` to `captureVoice(...)`.
- **Speech implementation in installed bundle:** `nf()` uses Web Speech API recognition, defaults the language selector to Tamil (`ta-IN`), and discards `event.error` in `onerror`.
- **Current source implementation:** `frontend/src/voice.js` calls `registerPlugin('MdwSpeechRecognition')`; when running natively it subscribes to native result/error/status events and calls `startRecognition({ language })`.
- **Capacitor registration/config:** `MainActivity` registers `MdwSpeechRecognitionPlugin`. Capacitor config uses app ID `com.mdwelders.business`, `webDir: "dist"`, and `bundledWebRuntime: false`. Capacitor Android is installed at `7.6.10`; the frontend manifest declares `^7.0.0`.
- **Manifest permissions:** `android/app/src/main/AndroidManifest.xml` declares `INTERNET`, `ACCESS_NETWORK_STATE`, and `RECORD_AUDIO`. The microphone hardware feature is optional.
- **Runtime microphone permission:** Android reports `RECORD_AUDIO: granted=true` for MD WELDERS. The Google recognition app is installed and also reports `RECORD_AUDIO: granted=true`.

## WebView and recognition service

- Device: Android 15 (API 35), Infinix X6871.
- WebView provider: `com.google.android.webview` version `156.0.8078.47`.
- Runtime inspection of the app WebView returned `typeof SpeechRecognition === "function"` and `typeof webkitSpeechRecognition === "function"`; the API is exposed in this installed WebView.
- Android resolves `android.speech.RecognitionService` to `com.google.android.googlequicksearchbox/com.google.android.voicesearch.serviceapi.GoogleRecognitionService`.

## Device test and Logcat

Cleared Logcat and tapped the installed app's `Speak` button. At `20:59:09`, Logcat showed Android launching the permission-controller activity from the MD WELDERS app. The permission activity returned to MD WELDERS shortly afterward. The app permission remained granted.

No `SpeechRecognizer`, `RecognitionService`, Chromium/WebView, or MD WELDERS `AndroidRuntime` error identifying the recognition failure appeared in that capture. Logcat therefore does not establish a denied microphone permission or an unavailable recognition service.

The device was in `MODE_IN_CALL` during the attempted test, with audio routed to Bluetooth SCO earbuds (`AirBass Earbuds`; mode set at `20:55:10`). No spoken phrase was supplied during the automated tap. That attempt cannot establish the recognition result under normal, idle audio conditions, and the active call could affect microphone capture.

## Conclusion

The installed app displays a generic error because its packaged assistant still uses the Web Speech API callback that suppresses the actual recognition error; it does not use the current source's native Capacitor plugin path. The available Logcat and in-call test conditions do **not** identify the underlying speech-service error code. Voice success was not verified. No code was changed, and the APK was not rebuilt or reinstalled.
