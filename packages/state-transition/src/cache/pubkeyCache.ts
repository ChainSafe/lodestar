import {type PubkeyCache} from "@lodestar/native/pubkeys";
import {Epoch, ValidatorIndex} from "@lodestar/types";
import {byteArrayEquals} from "@lodestar/utils";
import {IBeaconStateView} from "../stateView/interface.js";
import {BeaconStateAllForks} from "./types.js";

export type PubkeyCacheState =
  | Pick<BeaconStateAllForks, "validators">
  | Pick<IBeaconStateView, "validatorCount" | "getValidator">;

/** The state must share the finalized registry prefix, including canonical historical states. */
export function getValidatorIndex(
  state: PubkeyCacheState,
  pubkey: Uint8Array,
  pubkeyCache: PubkeyCache
): ValidatorIndex | null {
  const validatorCount = "validators" in state ? state.validators.length : state.validatorCount;
  const index = pubkeyCache.getIndex(pubkey);
  if (index !== null && index < validatorCount) {
    return index;
  }

  for (const candidate of pubkeyCache.getCandidates(pubkey)) {
    if (candidate >= validatorCount) {
      continue;
    }
    const candidatePubkey =
      "validators" in state ? state.validators.getReadonly(candidate).pubkey : state.getValidator(candidate).pubkey;
    if (byteArrayEquals(pubkey, candidatePubkey)) {
      return candidate;
    }
  }

  return null;
}

export function getValidatorPubkey(
  state: PubkeyCacheState,
  index: ValidatorIndex,
  pubkeyCache: PubkeyCache
): Uint8Array {
  return (
    pubkeyCache.getPubkeyBytes(index) ??
    ("validators" in state ? state.validators.getReadonly(index).pubkey : state.getValidator(index).pubkey)
  );
}

/** The canonical head must descend from the finalized checkpoint before promoting its registry prefix. */
export function promoteFinalizedPubkeys(
  pubkeyCache: PubkeyCache,
  state: Pick<IBeaconStateView, "validatorCount" | "getValidator">,
  finalizedEpoch: Epoch
): void {
  const size = pubkeyCache.size;
  for (let lastIndex = state.validatorCount - 1; lastIndex >= size; lastIndex--) {
    if (state.getValidator(lastIndex).activationEligibilityEpoch > finalizedEpoch) {
      continue;
    }
    for (let index = size; index <= lastIndex; index++) {
      pubkeyCache.append(index, state.getValidator(index).pubkey);
    }
    break;
  }
  pubkeyCache.pruneCandidates();
}
