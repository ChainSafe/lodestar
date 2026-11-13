import {type PubkeyCache} from "@lodestar/native/pubkeys";
import {Epoch, ValidatorIndex} from "@lodestar/types";
import {byteArrayEquals} from "@lodestar/utils";
import {IBeaconStateView} from "../stateView/interface.js";
import {BeaconStateAllForks} from "./types.js";

export type PubkeyCacheState =
  | Pick<BeaconStateAllForks, "validators">
  | Pick<IBeaconStateView, "validatorCount" | "getValidator">;

export function getStateValidatorCount(state: PubkeyCacheState): number {
  return "validators" in state ? state.validators.length : state.validatorCount;
}

function getStateValidatorPubkey(state: PubkeyCacheState, index: ValidatorIndex): Uint8Array {
  return "validators" in state ? state.validators.getReadonly(index).pubkey : state.getValidator(index).pubkey;
}

/** The state must share the finalized registry prefix, including canonical historical states. */
export function getValidatorIndex(
  pubkeyCache: PubkeyCache,
  state: PubkeyCacheState,
  pubkey: Uint8Array
): ValidatorIndex | null {
  const validatorCount = getStateValidatorCount(state);
  const index = pubkeyCache.getIndex(pubkey);
  if (index !== null && index < validatorCount) {
    return index;
  }

  for (const candidate of pubkeyCache.getCandidates(pubkey)) {
    if (candidate < validatorCount && byteArrayEquals(pubkey, getStateValidatorPubkey(state, candidate))) {
      return candidate;
    }
  }

  return null;
}

export function getValidatorPubkeyBytes(
  pubkeyCache: PubkeyCache,
  state: PubkeyCacheState,
  index: ValidatorIndex
): Uint8Array {
  return pubkeyCache.getPubkeyBytes(index) ?? getStateValidatorPubkey(state, index);
}

/** The accepted state must descend from the finalized checkpoint before promoting its registry prefix. */
export function promoteFinalizedPubkeys(
  pubkeyCache: PubkeyCache,
  state: Pick<IBeaconStateView, "validatorCount" | "getValidator">,
  finalizedEpoch: Epoch
): void {
  const size = pubkeyCache.size;
  let lastIndex = state.validatorCount - 1;
  while (lastIndex >= size && state.getValidator(lastIndex).activationEligibilityEpoch > finalizedEpoch) {
    lastIndex--;
  }
  for (let index = size; index <= lastIndex; index++) {
    pubkeyCache.append(index, state.getValidator(index).pubkey);
  }
  pubkeyCache.pruneCandidates();
}
