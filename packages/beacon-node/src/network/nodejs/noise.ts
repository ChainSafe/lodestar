import {newInstance, ChaCha20Poly1305} from "@chainsafe/as-chacha20poly1305-2";
import type {ConnectionEncrypter} from "@libp2p/interface-connection-encrypter";
import {ICryptoInterface, noise, stablelib} from "@chainsafe/libp2p-noise";
import {digest} from "@chainsafe/as-sha256";

type bytes = Uint8Array;
type bytes32 = Uint8Array;

const ctx = newInstance();
const asImpl = new ChaCha20Poly1305(ctx);

// same to stablelib but we use as-chacha20poly1305 and as-sha256
// TODO: find a way to reuse the following code
const lodestarCrypto: ICryptoInterface = {
  ...stablelib,
  hashSHA256(data: Uint8Array): Uint8Array {
    return digest(data);
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
