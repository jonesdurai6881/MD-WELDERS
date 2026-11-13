import { Capacitor, registerPlugin } from '@capacitor/core';

const NativeSpeechRecognition = registerPlugin('MdwSpeechRecognition');
let activeSession;

function clearSession(session) {
  if (activeSession !== session) return;
  activeSession = null;
  clearTimeout(session.stopTimer);
  for (const listener of session.listeners || []) {
    Promise.resolve().then(() => listener.remove()).catch(error => {
      console.error('Could not remove a speech recognition listener.', error);
    });
  }
  session.recognition?.removeEventListener('result', session.onResult);
  session.recognition?.removeEventListener('error', session.onError);
  session.recognition?.removeEventListener('end', session.onEnd);
  session.resolve?.();
}

export async function stopVoiceInput() {
  const session = activeSession;
  if (!session) return;
  if (session.native) {
    try {
      await NativeSpeechRecognition.stopRecognition();
      const timedOut = await Promise.race([
        session.done.then(() => false),
        new Promise(resolve => { session.stopTimer = setTimeout(() => resolve(true), 5000); })
      ]);
      if (timedOut) await NativeSpeechRecognition.cancelRecognition();
      clearSession(session);
      session.onStatus?.('idle');
    } catch (error) {
      clearSession(session);
      session.onStatus?.('idle');
      throw error;
    }
    return;
  }
  try { session.recognition.stop(); }
  catch (error) {
    clearSession(session);
    session.onStatus?.('idle');
    session.onError?.(error.message || 'Speech recognition could not stop.');
  }
}

export function isVoiceInputActive() {
  return Boolean(activeSession);
}

export async function startVoiceInput({ language = 'en-IN', onResult, onPartial, onStatus, onError } = {}) {
  await stopVoiceInput();
  let resolveSession;
  const session = {
    listeners: [],
    native: Capacitor.isNativePlatform(),
    onStatus,
    done: new Promise(resolve => { resolveSession = resolve; }),
    resolve: () => resolveSession()
  };
  activeSession = session;
  onStatus?.('listening');
  if (session.native) {
    try {
      session.listeners.push(await NativeSpeechRecognition.addListener('speechResult', event => {
        if (activeSession !== session) return;
        if (event.transcript) onResult?.(event.transcript);
        clearSession(session);
        onStatus?.('idle');
      }));
      session.listeners.push(await NativeSpeechRecognition.addListener('speechError', event => {
        if (activeSession !== session) return;
        clearSession(session);
        onStatus?.('idle');
        onError?.(event.message || 'Speech recognition failed. Check microphone permission and try again.');
      }));
      session.listeners.push(await NativeSpeechRecognition.addListener('speechStatus', event => {
        if (activeSession === session) onStatus?.(event.status || 'listening');
      }));
      session.listeners.push(await NativeSpeechRecognition.addListener('speechPartial', event => {
        if (activeSession !== session) return;
        if (event.transcript) onPartial?.(event.transcript);
      }));
      await NativeSpeechRecognition.startRecognition({ language });
    } catch (error) {
      clearSession(session);
      onStatus?.('idle');
      onError?.(error.message || 'Speech recognition could not start.');
    }
    return;
  }

  const Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  if (!Recognition) {
    clearSession(session);
    onStatus?.('idle');
    onError?.('Voice typing is not available in this browser. You can continue by typing.');
    return;
  }
  const recognition = new Recognition();
  session.recognition = recognition;
  session.onPartial = onPartial;
  recognition.lang = language;
  recognition.continuous = true;
  recognition.interimResults = true;
  session.onResult = event => {
    let transcript = '';
    let interim = '';
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      if (result.isFinal) transcript += result[0].transcript;
      else interim += result[0].transcript;
    }
    if (transcript.trim()) onResult?.(transcript.trim());
    if (interim.trim()) session.onPartial?.(interim.trim());
  };
  session.onError = event => {
    clearSession(session);
    onStatus?.('idle');
    const messages = {
      'not-allowed': 'Microphone permission was denied. Allow microphone access in device settings.',
      'service-not-allowed': 'Speech recognition service is not available on this device.',
      'network': 'Speech recognition needs a connection on this device. Try again online or type instead.',
      'no-speech': 'No speech was detected. Try again closer to the microphone.',
      'audio-capture': 'The microphone could not be accessed. Check microphone permission and try again.',
      'language-not-supported': 'The selected speech language is not supported on this device.',
      'aborted': 'Speech recognition was stopped before it finished.'
    };
    const message = messages[event.error]
      || `Speech recognition failed (${event.error || 'unknown error'})${event.message ? `: ${event.message}` : '.'}`;
    onError?.(message);
  };
  session.onEnd = () => {
    clearSession(session);
    onStatus?.('idle');
  };
  recognition.addEventListener('result', session.onResult);
  recognition.addEventListener('error', session.onError);
  recognition.addEventListener('end', session.onEnd);
  try { recognition.start(); }
  catch (error) {
    clearSession(session);
    onStatus?.('idle');
    onError?.(error.message || 'Speech recognition could not start.');
  }
}
