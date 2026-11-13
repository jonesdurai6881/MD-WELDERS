import { Capacitor, registerPlugin } from '@capacitor/core';

const NativeSecureStorage = registerPlugin('MdwSecureStorage');
const memory = new Map();

export async function secureGet(key) {
  if (!Capacitor.isNativePlatform()) return memory.get(key) || null;
  const result = await NativeSecureStorage.get({ key });
  return typeof result.value === 'string' ? result.value : null;
}

export async function secureSet(key, value) {
  if (!Capacitor.isNativePlatform()) {
    memory.set(key, value);
    return;
  }
  await NativeSecureStorage.set({ key, value });
}

export async function secureRemove(key) {
  if (!Capacitor.isNativePlatform()) {
    memory.delete(key);
    return;
  }
  await NativeSecureStorage.remove({ key });
}
