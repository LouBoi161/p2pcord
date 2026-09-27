package io.gitlab.louiswalder6.p2pcord;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.file.Files;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.util.Arrays;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * The vault key seals identity, group keys and group list at rest (see
 * workers/vault.js). Here it is wrapped by an AES key in the Android Keystore,
 * which never leaves the secure hardware; files/vault.key holds only
 * IV + ciphertext.
 */
final class VaultKey {
  private static final String TAG = "P2Pcord";
  private static final String ALIAS = "p2pcord-vault";
  private static final String FILE = "vault.key";

  private VaultKey() {}

  /** The first frame for the backend: { type: 'vault', key, mode } or { type: 'vault', error } */
  static String frame(Context context) {
    JSONObject out = new JSONObject();
    try {
      out.put("type", "vault");
      try {
        out.put("key", hex(load(context)));
        out.put("mode", "keyring");
      } catch (Exception e) {
        Log.e(TAG, "vault", e);
        out.put("error", "VAULT_KEYRING");
      }
    } catch (JSONException ignored) {
    }
    return out.toString();
  }

  private static byte[] load(Context context) throws Exception {
    File file = new File(context.getFilesDir(), FILE);
    SecretKey wrap = wrappingKey();
    if (file.exists()) {
      byte[] stored = Files.readAllBytes(file.toPath());
      Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(Cipher.DECRYPT_MODE, wrap, new GCMParameterSpec(128, Arrays.copyOfRange(stored, 0, 12)));
      return cipher.doFinal(stored, 12, stored.length - 12);
    }
    byte[] key = new byte[32];
    new SecureRandom().nextBytes(key);
    Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
    cipher.init(Cipher.ENCRYPT_MODE, wrap);
    byte[] iv = cipher.getIV();
    byte[] sealed = cipher.doFinal(key);
    File tmp = new File(context.getFilesDir(), FILE + ".tmp");
    try (FileOutputStream out = new FileOutputStream(tmp)) {
      out.write(iv);
      out.write(sealed);
      out.getFD().sync();
    }
    if (!tmp.renameTo(file)) throw new IllegalStateException("cannot write " + FILE);
    return key;
  }

  private static SecretKey wrappingKey() throws Exception {
    KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
    ks.load(null);
    if (ks.containsAlias(ALIAS)) return (SecretKey) ks.getKey(ALIAS, null);
    KeyGenerator gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
    gen.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .setKeySize(256)
      .build());
    return gen.generateKey();
  }

  private static String hex(byte[] bytes) {
    StringBuilder sb = new StringBuilder(bytes.length * 2);
    for (byte b : bytes) sb.append(String.format("%02x", b));
    return sb.toString();
  }
}
