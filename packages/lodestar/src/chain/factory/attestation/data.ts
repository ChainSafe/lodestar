import {hashTreeRoot, signingRoot} from "@chainsafe/ssz";
import {BeaconDb} from "../../../db/api";
import {AttestationData, BeaconBlock, BeaconState, Shard} from "../../../types";
import {getBlockRoot, getCurrentEpoch, computeStartSlotOfEpoch} from "../../stateTransition/util";
import {FAR_FUTURE_EPOCH, GENESIS_EPOCH, ZERO_HASH} from "../../../constants";
import {IBeaconConfig} from "../../../config";

export async function assembleAttestationData(
  config: IBeaconConfig,
  db: BeaconDb,
  headState: BeaconState,
  headBlock: BeaconBlock,
  shard: Shard): Promise<AttestationData> {

  const currentEpoch = getCurrentEpoch(config, headState);
  const epochStartSlot = computeStartSlotOfEpoch(config, currentEpoch);
  let epochBoundaryBlock: BeaconBlock;
  if (epochStartSlot === headState.slot) {
    epochBoundaryBlock = headBlock;
  } else {
    epochBoundaryBlock = await db.block.get(getBlockRoot(config, headState, epochStartSlot));
  }

  return {
    crosslink: {
      startEpoch:GENESIS_EPOCH,
      endEpoch:FAR_FUTURE_EPOCH,
      dataRoot: ZERO_HASH,
      shard: shard,
      parentRoot: hashTreeRoot(headState.currentCrosslinks[shard], config.types.Crosslink) //produces exceptions...
    },
    beaconBlockRoot: signingRoot(headBlock, config.types.BeaconBlock),
    source: headState.currentJustifiedCheckpoint,
    target: {
      epoch: currentEpoch,
      root: signingRoot(epochBoundaryBlock, config.types.BeaconBlock),
    },
  };
}
