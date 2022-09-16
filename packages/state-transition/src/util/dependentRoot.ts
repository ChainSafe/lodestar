import {byteArrayEquals} from "@chainsafe/ssz";
import {GENESIS_SLOT} from "@lodestar/params";
import {Epoch, Root} from "@lodestar/types";
import {ZERO_HASH} from "../constants/constants.js";
import {BeaconStateAllForks} from "../types.js";
import {getBlockRootAtSlot} from "./blockRoot.js";
import {computeEpochAtSlot, computeStartSlotAtEpoch} from "./epoch.js";

/**
 * Returns the block root which decided the proposer shuffling for the current epoch. This root
 * can be used to key this proposer shuffling.
 */
export function proposerShufflingDependentRoot(state: BeaconStateAllForks): Root {
  const requestedEpoch = computeEpochAtSlot(state.slot);
  // Last slot in epoch `requestedEpoch - 1`
  const decisionSlot = Math.max(computeStartSlotAtEpoch(requestedEpoch) - 1, 0);

  if (state.slot === GENESIS_SLOT && decisionSlot === GENESIS_SLOT) {
    return getGenesisBlockRoot(state);
  } else {
    return getBlockRootAtSlot(state, decisionSlot);
  }
}

/**
 * Returns the block root which decided the attester shuffling for the given `requestedEpoch`.
 * This root can be used to key that attester shuffling.
 */
export function attesterShufflingDependentRoot(state: BeaconStateAllForks, requestedEpoch: Epoch): Root {
  // Last slot in epoch `requestedEpoch - 2`
  const decisionSlot = Math.max(computeStartSlotAtEpoch(requestedEpoch - 1) - 1, 0);

  if (state.slot === GENESIS_SLOT && decisionSlot === GENESIS_SLOT) {
    return getGenesisBlockRoot(state);
  } else {
    return getBlockRootAtSlot(state, decisionSlot);
  }
}

/**
 * Computes genesis block root from data available in a state with state.slot < SLOTS_PER_HISTORICAL_ROOT
 */
function getGenesisBlockRoot(state: BeaconStateAllForks): Root {
  if (state.slot === GENESIS_SLOT) {
    // Clone only if necessary
    let latestBlockHeader = state.latestBlockHeader;

    if (byteArrayEquals(latestBlockHeader.stateRoot, ZERO_HASH)) {
      // false = do not transfer cache
      latestBlockHeader = latestBlockHeader.clone(false);
      latestBlockHeader.stateRoot = state.hashTreeRoot();
    }

    return latestBlockHeader.hashTreeRoot();
  }

  return getBlockRootAtSlot(state, GENESIS_SLOT);
}
