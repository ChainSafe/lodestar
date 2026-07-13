import {phase0} from "@lodestar/types";
import {type PubkeyCache} from "../bls/index.js";

/**
 * Checks the pubkey indices against a state and adds missing pubkeys
 *
 * Mutates `pubkeyCache`
 *
 * If pubkey cache is empty: SLOW CODE - 🐢
 */
export function syncPubkeys(pubkeyCache: PubkeyCache, validators: phase0.Validator[]): void {
  const newCount = validators.length;
  for (let i = pubkeyCache.size; i < newCount; i++) {
    pubkeyCache.set(i, validators[i].pubkey);
  }
}
