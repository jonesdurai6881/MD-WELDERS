import test from 'node:test';
import assert from 'node:assert/strict';
import { isVoiceInputActive, startVoiceInput } from '../frontend/src/voice.js';

class FakeSpeechRecognition {
  constructor() {
    this.listeners = new Map();
    FakeSpeechRecognition.instance = this;
  }

  addEventListener(name, listener) {
    this.listeners.set(name, listener);
  }

  removeEventListener(name, listener) {
    if (this.listeners.get(name) === listener) this.listeners.delete(name);
  }

  start() {}

  emit(name, properties = {}) {
    const event = new Event(name);
    Object.assign(event, properties);
    this.listeners.get(name)?.(event);
  }
}

test('speech errors report their cause and clean up the recognition session', async () => {
  const previousRecognition = globalThis.SpeechRecognition;
  let errorMessage = '';
  const statuses = [];
  globalThis.SpeechRecognition = FakeSpeechRecognition;

  try {
    await startVoiceInput({
      onStatus: status => statuses.push(status),
      onError: message => { errorMessage = message; }
    });

    const recognition = FakeSpeechRecognition.instance;
    assert.equal(isVoiceInputActive(), true);
    recognition.emit('error', { error: 'network' });
    await Promise.resolve();

    assert.equal(errorMessage, 'Speech recognition needs a connection on this device. Try again online or type instead.');
    assert.equal(isVoiceInputActive(), false);
    assert.deepEqual(statuses, ['listening', 'idle']);
    assert.equal(recognition.listeners.size, 0);
  } finally {
    if (previousRecognition === undefined) delete globalThis.SpeechRecognition;
    else globalThis.SpeechRecognition = previousRecognition;
  }
});

test('voice input applies Tamil and Indian English locales and returns final transcripts', async () => {
  const previousRecognition = globalThis.SpeechRecognition;
  globalThis.SpeechRecognition = FakeSpeechRecognition;

  try {
    for (const [language, transcript] of [['ta-IN', 'செலவு'], ['en-IN', 'test expense']]) {
      let receivedTranscript = '';
      await startVoiceInput({
        language,
        onResult: value => { receivedTranscript = value; }
      });

      const recognition = FakeSpeechRecognition.instance;
      assert.equal(recognition.lang, language);
      recognition.emit('result', {
        resultIndex: 0,
        results: [{ 0: { transcript }, isFinal: true }]
      });
      assert.equal(receivedTranscript, transcript);
      recognition.emit('end');
      assert.equal(isVoiceInputActive(), false);
    }
  } finally {
    if (previousRecognition === undefined) delete globalThis.SpeechRecognition;
    else globalThis.SpeechRecognition = previousRecognition;
  }
});
