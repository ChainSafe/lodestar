import crypto from "node:crypto";
import type {ConnectionEncrypter} from "@libp2p/interface/connection-encrypter";
import {ICryptoInterface, noise, pureJsCrypto} from "@chainsafe/libp2p-noise";
import {digest} from "@chainsafe/as-sha256";
import {newInstance, ChaCha20Poly1305} from "@chainsafe/as-chacha20poly1305";

const ctx = newInstance();
const asImpl = new ChaCha20Poly1305(ctx);

const CHACHA_POLY1305 = "chacha20-poly1305";

const nodeCrypto: Pick<ICryptoInterface, "hashSHA256" | "chaCha20Poly1305Encrypt" | "chaCha20Poly1305Decrypt"> = {
  hashSHA256(data) {
    return crypto.createHash("sha256").update(data).digest();
  },

  chaCha20Poly1305Encrypt(plaintext, nonce, ad, k) {
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

  chaCha20Poly1305Decrypt(ciphertext, nonce, ad, k, _dst) {
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

const asCrypto: Pick<ICryptoInterface, "hashSHA256" | "chaCha20Poly1305Encrypt" | "chaCha20Poly1305Decrypt"> = {
  hashSHA256(data) {
    return digest(data);
  },
  chaCha20Poly1305Encrypt(plaintext, nonce, ad, k) {
    return asImpl.seal(k, nonce, plaintext, ad);
  },
  chaCha20Poly1305Decrypt(ciphertext, nonce, ad, k, dst) {
    return asImpl.open(k, nonce, ciphertext, ad, dst);
  },
};

// benchmarks show that for chacha20poly1305
// the as implementation is faster for smaller payloads(<1200)
// and the node implementation is faster for larger payloads
const lodestarCrypto: ICryptoInterface = {
  ...pureJsCrypto,
  hashSHA256(data) {
    return nodeCrypto.hashSHA256(data);
  },
  chaCha20Poly1305Encrypt(plaintext, nonce, ad, k) {
    if (plaintext.length < 1200) {
      return asCrypto.chaCha20Poly1305Encrypt(plaintext, nonce, ad, k);
    }
    return nodeCrypto.chaCha20Poly1305Encrypt(plaintext, nonce, ad, k);
  },
  chaCha20Poly1305Decrypt(ciphertext, nonce, ad, k, dst) {
    if (ciphertext.length < 1200) {
      return asCrypto.chaCha20Poly1305Decrypt(ciphertext, nonce, ad, k, dst);
    }
    return nodeCrypto.chaCha20Poly1305Decrypt(ciphertext, nonce, ad, k, dst);
  },
};

export function createNoise(): () => ConnectionEncrypter {
  return noise({crypto: lodestarCrypto});
}
