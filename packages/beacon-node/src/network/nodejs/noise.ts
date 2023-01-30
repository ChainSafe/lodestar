import type {ConnectionEncrypter} from "@libp2p/interface-connection-encrypter";
import {newInstance, ChaCha20Poly1305} from "@chainsafe/as-chacha20poly1305";
import {ICryptoInterface, noise, stablelib} from "@chainsafe/libp2p-noise";
import {digest} from "@chainsafe/as-sha256";

type Bytes = Uint8Array;
type Bytes32 = Uint8Array;

const ctx = newInstance();
const asImpl = new ChaCha20Poly1305(ctx);

// same to stablelib but we use as-chacha20poly1305 and as-sha256
const lodestarCrypto: ICryptoInterface = {
  ...stablelib,
  hashSHA256(data: Uint8Array): Uint8Array {
    return digest(data);
  },

  chaCha20Poly1305Encrypt(plaintext: Uint8Array, nonce: Uint8Array, ad: Uint8Array, k: Bytes32): Bytes {
    return asImpl.seal(k, nonce, plaintext, ad);
  },

  chaCha20Poly1305Decrypt(
    ciphertext: Uint8Array,
    nonce: Uint8Array,
    ad: Uint8Array,
    k: Bytes32,
    dst?: Uint8Array
  ): Bytes | null {
    return asImpl.open(k, nonce, ciphertext, ad, dst);
  },
};

export function createNoise(): () => ConnectionEncrypter {
  return noise({crypto: lodestarCrypto});
}
