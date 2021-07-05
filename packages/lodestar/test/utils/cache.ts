import {SecretKey} from "@chainsafe/bls";
import {toHexString} from "@chainsafe/ssz";

export function memoOnce<R>(fn: () => R): () => R {
  let value: R | null = null;
  return function () {
    if (value === null) {
      value = fn();
    }
    return value;
  };
}

const signCache = new WeakMap<SecretKey, Map<string, Uint8Array>>();

/**
 * **USE FOR TESTING ONLY**
 *
 * Caches the signatures associated to a `SecretKey` instance.
 * Usefull to speed up testing if the same message is signed multiple times.
 */
export function signCached(sk: SecretKey, message: Uint8Array): Uint8Array {
  const messageHex = toHexString(message);
  let cache = signCache.get(sk);
  if (!cache) {
    cache = new Map<string, Uint8Array>();
    signCache.set(sk, cache);
  }

  const prevSig = cache.get(messageHex);
  if (prevSig) {
    return prevSig;
  }

  const sig = sk.sign(message).toBytes();
  cache.set(messageHex, sig);

  return sig;
}
