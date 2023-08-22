import crypto from "node:crypto";
import type {ConnectionEncrypter} from "@libp2p/interface/connection-encrypter";
import {ICryptoInterface, noise, pureJsCrypto} from "@chainsafe/libp2p-noise";

type Bytes = Uint8Array;
type Bytes32 = Uint8Array;

const CHACHA_POLY1305 = "chacha20-poly1305";

// same as default, but we use node crypto chacha20poly1305 and sha256
const lodestarCrypto: ICryptoInterface = {
  ...pureJsCrypto,
  hashSHA256(data: Uint8Array): Uint8Array {
    return crypto.createHash("sha256").update(data).digest();
  },

  chaCha20Poly1305Encrypt(plaintext: Uint8Array, nonce: Uint8Array, ad: Uint8Array, k: Bytes32): Bytes {
    const cipher = crypto.createCipheriv(CHACHA_POLY1305, k, nonce, {
      authTagLength: 16,
    });
    cipher.setAAD(ad, {plaintextLength: plaintext.byteLength});
    const updated = cipher.update(plaintext);
    const final = cipher.final();
    const tag = cipher.getAuthTag();

    const encrypted = Buffer.concat([updated, tag, final]);
    return encrypted;
  },

  chaCha20Poly1305Decrypt(
    ciphertext: Uint8Array,
    nonce: Uint8Array,
    ad: Uint8Array,
    k: Bytes32,
    _dst?: Uint8Array
  ): Bytes | null {
    const authTag = ciphertext.slice(ciphertext.length - 16);
    const text = ciphertext.slice(0, ciphertext.length - 16);
    const decipher = crypto.createDecipheriv(CHACHA_POLY1305, k, nonce, {
      authTagLength: 16,
    });
    decipher.setAAD(ad, {
      plaintextLength: text.byteLength,
    });
    decipher.setAuthTag(authTag);
    const updated = decipher.update(text);
    const final = decipher.final();
    if (final.byteLength > 0) {
      return Buffer.concat([updated, final]);
    }
    return updated;
  },
};

export function createNoise(): () => ConnectionEncrypter {
  return noise({crypto: lodestarCrypto});
}
