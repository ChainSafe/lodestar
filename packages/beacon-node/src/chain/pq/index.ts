import {pubkeyCache} from "@lodestar/native/pubkeys";
import {ValidatorIndex, pq} from "@lodestar/types";

export * from "./verifier.js";

/**
 * The leanXMSS public key of a validator. The pubkey cache holds it as requests name it: 16 zero
 * bytes, then the key.
 */
export function getXmssPubkey(index: ValidatorIndex): pq.XMSSPubkey {
  return pubkeyCache.getPubkeyBytesOrThrow(index).subarray(16);
}
