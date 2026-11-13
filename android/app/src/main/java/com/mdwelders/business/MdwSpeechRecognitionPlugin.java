package com.mdwelders.business;

import android.Manifest;
import android.content.Intent;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;

@CapacitorPlugin(
    name = "MdwSpeechRecognition",
    permissions = @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO })
)
public class MdwSpeechRecognitionPlugin extends Plugin {
    private SpeechRecognizer recognizer;

    @PluginMethod
    public void startRecognition(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "microphonePermissionResult");
            return;
        }
        beginRecognition(call);
    }

    @PermissionCallback
    private void microphonePermissionResult(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            call.reject("Microphone permission is required for voice input.");
            return;
        }
        beginRecognition(call);
    }

    @PluginMethod
    public void stopRecognition(PluginCall call) {
        try {
            if (recognizer != null) {
                recognizer.stopListening();
            }
            call.resolve();
        } catch (RuntimeException exception) {
            destroyRecognizer();
            call.reject("Android speech recognition could not stop: " + exception.getMessage(), exception);
        }
    }

    @PluginMethod
    public void cancelRecognition(PluginCall call) {
        try {
            if (recognizer != null) {
                recognizer.cancel();
                destroyRecognizer();
            }
            call.resolve();
        } catch (RuntimeException exception) {
            destroyRecognizer();
            call.reject("Android speech recognition could not be cancelled: " + exception.getMessage(), exception);
        }
    }

    private void beginRecognition(PluginCall call) {
        if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
            call.reject("No speech recognition service is available on this device.");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                destroyRecognizer();
                recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
                recognizer.setRecognitionListener(new RecognitionListener() {
                    @Override public void onReadyForSpeech(Bundle params) { notifyListeners("speechStatus", status("listening")); }
                    @Override public void onBeginningOfSpeech() { }
                    @Override public void onRmsChanged(float rmsdB) { }
                    @Override public void onBufferReceived(byte[] buffer) { }
                    @Override public void onEndOfSpeech() { notifyListeners("speechStatus", status("processing")); }
                    @Override public void onError(int error) {
                        JSObject event = new JSObject();
                        event.put("code", error);
                        event.put("error", errorName(error));
                        event.put("message", "Android speech recognition failed: " + errorName(error) + " (code " + error + "). " + errorDescription(error));
                        try {
                            notifyListeners("speechError", event);
                        } finally {
                            destroyRecognizer();
                        }
                    }
                    @Override public void onResults(Bundle results) {
                        try {
                            ArrayList<String> matches = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                            if (matches == null || matches.isEmpty()) {
                                JSObject event = new JSObject();
                                event.put("code", SpeechRecognizer.ERROR_NO_MATCH);
                                event.put("error", errorName(SpeechRecognizer.ERROR_NO_MATCH));
                                event.put("message", errorDescription(SpeechRecognizer.ERROR_NO_MATCH));
                                notifyListeners("speechError", event);
                            } else {
                                JSObject event = new JSObject();
                                event.put("transcript", matches.get(0));
                                notifyListeners("speechResult", event);
                            }
                        } finally {
                            destroyRecognizer();
                        }
                    }
                    @Override public void onPartialResults(Bundle partialResults) {
                        ArrayList<String> matches = partialResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                        if (matches != null && !matches.isEmpty()) {
                            JSObject event = new JSObject();
                            event.put("transcript", matches.get(0));
                            notifyListeners("speechPartial", event);
                        }
                    }
                    @Override public void onEvent(int eventType, Bundle params) { }
                });

                String language = call.getString("language", "en-IN");
                Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, language);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, language);
                intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
                recognizer.startListening(intent);
                call.resolve();
            } catch (RuntimeException exception) {
                destroyRecognizer();
                call.reject("Android speech recognition could not start: " + exception.getMessage(), exception);
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        destroyRecognizer();
        super.handleOnDestroy();
    }

    private String errorName(int error) {
        switch (error) {
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT: return "NETWORK_TIMEOUT";
            case SpeechRecognizer.ERROR_NETWORK: return "NETWORK";
            case SpeechRecognizer.ERROR_AUDIO: return "AUDIO";
            case SpeechRecognizer.ERROR_SERVER: return "SERVER";
            case SpeechRecognizer.ERROR_CLIENT: return "CLIENT";
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT: return "SPEECH_TIMEOUT";
            case SpeechRecognizer.ERROR_NO_MATCH: return "NO_MATCH";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY: return "RECOGNIZER_BUSY";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: return "INSUFFICIENT_PERMISSIONS";
            case SpeechRecognizer.ERROR_TOO_MANY_REQUESTS: return "TOO_MANY_REQUESTS";
            case SpeechRecognizer.ERROR_SERVER_DISCONNECTED: return "SERVER_DISCONNECTED";
            case SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED: return "LANGUAGE_NOT_SUPPORTED";
            case SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE: return "LANGUAGE_UNAVAILABLE";
            case SpeechRecognizer.ERROR_CANNOT_CHECK_SUPPORT: return "CANNOT_CHECK_SUPPORT";
            default: return "UNKNOWN";
        }
    }

    private String errorDescription(int error) {
        switch (error) {
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT: return "The network connection timed out.";
            case SpeechRecognizer.ERROR_NETWORK: return "The speech service could not reach the network.";
            case SpeechRecognizer.ERROR_AUDIO: return "The microphone audio could not be captured.";
            case SpeechRecognizer.ERROR_SERVER: return "The speech service returned an error.";
            case SpeechRecognizer.ERROR_CLIENT: return "The recognition request was cancelled or rejected.";
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT: return "No speech was detected.";
            case SpeechRecognizer.ERROR_NO_MATCH: return "No recognized words were returned.";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY: return "The speech recognizer is busy. Try again.";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: return "Microphone permission is required.";
            case SpeechRecognizer.ERROR_TOO_MANY_REQUESTS: return "Too many recognition requests were made. Try again later.";
            case SpeechRecognizer.ERROR_SERVER_DISCONNECTED: return "The speech service disconnected.";
            case SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED: return "The selected language is not supported.";
            case SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE: return "The selected language is unavailable.";
            case SpeechRecognizer.ERROR_CANNOT_CHECK_SUPPORT: return "The speech service could not verify language support.";
            default: return "An unknown speech recognition error occurred.";
        }
    }

    private JSObject status(String value) {
        JSObject event = new JSObject();
        event.put("status", value);
        return event;
    }

    private void destroyRecognizer() {
        if (recognizer != null) {
            recognizer.destroy();
            recognizer = null;
        }
    }
}
