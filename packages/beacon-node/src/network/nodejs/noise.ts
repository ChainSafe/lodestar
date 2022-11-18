import {HKDF} from "@stablelib/hkdf";
import * as x25519 from "@stablelib/x25519";
import {SHA256} from "@stablelib/sha256";
import {newInstance, ChaCha20Poly1305} from "ssz-3/packages/as-chacha20poly1305/lib/src/index";
import type {ConnectionEncrypter} from "@libp2p/interface-connection-encrypter";
import {ICryptoInterface, noise} from "@chainsafe/libp2p-noise";
import {digest} from "@chainsafe/as-sha256";

type bytes = Uint8Array;
type bytes32 = Uint8Array;
type Hkdf = [bytes, bytes, bytes];
interface KeyPair {
  publicKey: bytes32;
  privateKey: bytes32;
}

const ctx = newInstance();
const asImpl = new ChaCha20Poly1305(ctx);

// same to stablelib but we use as-chacha20poly1305 and as-sha256
// TODO: find a way to reuse the following code
const lodestarCrypto: ICryptoInterface = {
  hashSHA256(data: Uint8Array): Uint8Array {
    return digest(data);
  },

  getHKDF(ck: bytes32, ikm: Uint8Array): Hkdf {
    const hkdf = new HKDF(SHA256, ikm, ck);
    const okmU8Array = hkdf.expand(96);
    const okm = okmU8Array;

    const k1 = okm.subarray(0, 32);
    const k2 = okm.subarray(32, 64);
    const k3 = okm.subarray(64, 96);

    return [k1, k2, k3];
  },

  generateX25519KeyPair(): KeyPair {
    const keypair = x25519.generateKeyPair();

    return {
      publicKey: keypair.publicKey,
      privateKey: keypair.secretKey,
    };
  },

  generateX25519KeyPairFromSeed(seed: Uint8Array): KeyPair {
    const keypair = x25519.generateKeyPairFromSeed(seed);

    return {
      publicKey: keypair.publicKey,
      privateKey: keypair.secretKey,
    };
  },

  generateX25519SharedKey(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
    return x25519.sharedKey(privateKey, publicKey);
  },

  chaCha20Poly1305Encrypt(plaintext: Uint8Array, nonce: Uint8Array, ad: Uint8Array, k: bytes32): bytes {
    return asImpl.seal(k, nonce, plaintext, ad);
  },

  chaCha20Poly1305Decrypt(
    ciphertext: Uint8Array,
    nonce: Uint8Array,
    ad: Uint8Array,
    k: bytes32,
    dst?: Uint8Array
  ): bytes | null {
    return asImpl.open(k, nonce, ciphertext, ad, dst);
  },
};

export function createNoise(): ConnectionEncrypter {
  const factory = noise({crypto: lodestarCrypto});
  return factory() as ConnectionEncrypter;
}
