package com.mdwelders.business;

import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

@CapacitorPlugin(name = "MdwSecureStorage")
public class MdwSecureStoragePlugin extends Plugin {
    private static final String PREFERENCES = "mdw_secure_sync";
    private static final String KEY_ALIAS = "mdw_secure_sync_key_v1";
    private static final int NONCE_LENGTH = 12;

    @PluginMethod
    public void set(PluginCall call) {
        String key = call.getString("key");
        String value = call.getString("value");
        if (key == null || key.trim().isEmpty() || value == null) {
            call.reject("A key and value are required.");
            return;
        }
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
            byte[] nonce = cipher.getIV();
            byte[] ciphertext = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
            ByteBuffer encrypted = ByteBuffer.allocate(nonce.length + ciphertext.length);
            encrypted.put(nonce);
            encrypted.put(ciphertext);
            boolean saved = preferences().edit()
                .putString(key, Base64.encodeToString(encrypted.array(), Base64.NO_WRAP))
                .commit();
            if (!saved) throw new IllegalStateException("Encrypted value could not be persisted.");
            call.resolve();
        } catch (Exception exception) {
            call.reject("Secure storage could not save this value.", exception);
        }
    }

    @PluginMethod
    public void get(PluginCall call) {
        String key = call.getString("key");
        if (key == null || key.trim().isEmpty()) {
            call.reject("A key is required.");
            return;
        }
        try {
            String stored = preferences().getString(key, null);
            JSObject result = new JSObject();
            result.put("value", stored == null ? JSONObject.NULL : decrypt(stored));
            call.resolve(result);
        } catch (Exception exception) {
            call.reject("Secure storage could not read this value.", exception);
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String key = call.getString("key");
        if (key == null || key.trim().isEmpty()) {
            call.reject("A key is required.");
            return;
        }
        if (!preferences().edit().remove(key).commit()) {
            call.reject("Secure storage could not remove this value.");
            return;
        }
        call.resolve();
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFERENCES, android.content.Context.MODE_PRIVATE);
    }

    private SecretKey getOrCreateKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (keyStore.containsAlias(KEY_ALIAS)) return (SecretKey) keyStore.getKey(KEY_ALIAS, null);

        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        ).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .build());
        return generator.generateKey();
    }

    private String decrypt(String stored) throws Exception {
        byte[] encrypted = Base64.decode(stored, Base64.NO_WRAP);
        if (encrypted.length <= NONCE_LENGTH) throw new IllegalArgumentException("Stored ciphertext is invalid.");
        ByteBuffer data = ByteBuffer.wrap(encrypted);
        byte[] nonce = new byte[NONCE_LENGTH];
        data.get(nonce);
        byte[] ciphertext = new byte[data.remaining()];
        data.get(ciphertext);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(128, nonce));
        return new String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8);
    }
}
