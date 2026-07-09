import {type PubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {phase0} from "@lodestar/types";

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
