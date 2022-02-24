import {PointFormat, SecretKey} from "@chainsafe/bls";
import {BLSPubkey} from "@chainsafe/lodestar-types";
import {toHexString} from "@chainsafe/ssz";
import {PubkeyHex} from "../types";

export interface ISigner {
  sign(pubkey: BLSPubkey | PubkeyHex, signingRoot: Uint8Array): Uint8Array;
  addKey(secretKey: SecretKey): void;
  removeKey(pubkey: BLSPubkey | PubkeyHex): boolean;
  hasKey(pubkeyHex: PubkeyHex): boolean;
  hasSomeKeys(): boolean;
  getKeys(): PubkeyHex[];
}

/**
 * Signs messages while hidding secret keys from consumers.
 * Uses a closure to implement really private properties, enforced at runtime.
 */
export function getSignerLocal(): ISigner {
  const secretKeyMap = new Map<PubkeyHex, SecretKey>();

  return {
    sign(pubkey, signingRoot) {
      // TODO: Refactor indexing to not have to run toHexString() on the pubkey every time
      const pubkeyHex = typeof pubkey === "string" ? pubkey : toHexString(pubkey);
      const secretKey = secretKeyMap.get(pubkeyHex);

      if (!secretKey) {
        throw Error(`Validator ${pubkeyHex} not in local validators map`);
      }

      return secretKey.sign(signingRoot).toBytes(PointFormat.compressed);
    },

    addKey(secretKey) {
      const pubkeyHex = secretKey.toPublicKey().toBytes();
      secretKeyMap.set(toHexString(pubkeyHex), secretKey);
    },

    removeKey(pubkey) {
      const pubkeyHex = typeof pubkey === "string" ? pubkey : toHexString(pubkey);
      return secretKeyMap.delete(pubkeyHex);
    },

    hasKey(pubkeyHex) {
      return secretKeyMap.has(pubkeyHex);
    },

    hasSomeKeys() {
      return secretKeyMap.size > 0;
    },

    getKeys() {
      return Array.from(secretKeyMap.keys());
    },
  };
}
