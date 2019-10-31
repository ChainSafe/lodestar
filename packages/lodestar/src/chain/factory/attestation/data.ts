import {hashTreeRoot, signingRoot} from "@chainsafe/ssz";
import {AttestationData, BeaconBlock, BeaconState, Crosslink, Epoch, Shard, Hash} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {ZERO_HASH} from "../../../constants";
import {IBeaconDb} from "../../../db/api";
import {computeStartSlotOfEpoch, getBlockRootAtSlot, getCurrentEpoch} from "@chainsafe/eth2.0-state-transition";

export async function assembleAttestationData(
  config: IBeaconConfig,
  db: IBeaconDb,
  headState: BeaconState,
  headBlock: BeaconBlock,
  shard: Shard): Promise<AttestationData> {

  const currentEpoch = getCurrentEpoch(config, headState);
  const epochStartSlot = computeStartSlotOfEpoch(config, currentEpoch);

  let epochBoundaryBlockRoot: Hash;
  if (epochStartSlot === headState.slot) {
    epochBoundaryBlockRoot = signingRoot(headBlock, config.types.BeaconBlock);
  } else {
    epochBoundaryBlockRoot = getBlockRootAtSlot(config, headState, epochStartSlot);
  }
  if(!epochBoundaryBlockRoot) {
    throw new Error(`Missing target block at slot ${epochStartSlot} for attestation`);
  }

  return {
    crosslink: getCrosslinkVote(config, headState, shard, currentEpoch),
    beaconBlockRoot: signingRoot(headBlock, config.types.BeaconBlock),
    source: headState.currentJustifiedCheckpoint,
    target: {
      epoch: currentEpoch,
      root: epochBoundaryBlockRoot,
    },
  };
}


export function getCrosslinkVote(
  config: IBeaconConfig,
  state: BeaconState,
  shard: Shard,
  targetEpoch: Epoch
): Crosslink {
  const parentCrosslink = state.currentCrosslinks[shard];
  return  {
    startEpoch: parentCrosslink.endEpoch,
    endEpoch: Math.min(targetEpoch, parentCrosslink.endEpoch + config.params.MAX_EPOCHS_PER_CROSSLINK),
    dataRoot: ZERO_HASH,
    shard: shard,
    parentRoot: hashTreeRoot(state.currentCrosslinks[shard], config.types.Crosslink)
  };
}
