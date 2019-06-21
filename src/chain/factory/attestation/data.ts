import {BeaconDB} from "../../../db/api";
import {AttestationData, BeaconBlock, BeaconState, Crosslink, Shard} from "../../../types";
import {getBlockRoot, getCurrentEpoch, getEpochStartSlot} from "../../stateTransition/util";
import {FAR_FUTURE_EPOCH, GENESIS_EPOCH, ZERO_HASH} from "../../../constants";
import {hashTreeRoot, signingRoot} from "@chainsafe/ssz";

export async function assembleAttestationData(
  db: BeaconDB,
  headState: BeaconState,
  headBlock: BeaconBlock,
  shard: Shard): Promise<AttestationData> {
  const currentEpoch = getCurrentEpoch(headState);
  const epochStartSlot = getEpochStartSlot(currentEpoch);
  let epochBoundaryBlock: BeaconBlock;
  if (epochStartSlot === headState.slot) {
    epochBoundaryBlock = headBlock;
  } else {
    epochBoundaryBlock = await db.getBlock(getBlockRoot(headState, epochStartSlot));
  }
  return {
    crosslink: {
      startEpoch:GENESIS_EPOCH,
      endEpoch:FAR_FUTURE_EPOCH,
      dataRoot: ZERO_HASH,
      shard: shard,
      parentRoot:  hashTreeRoot(headState.currentCrosslinks[shard], Crosslink),
    },
    beaconBlockRoot: signingRoot(headBlock, BeaconBlock),
    sourceEpoch: headState.currentJustifiedEpoch,
    sourceRoot: headState.currentJustifiedRoot,
    targetEpoch: currentEpoch,
    targetRoot: signingRoot(epochBoundaryBlock, BeaconBlock)
  };
}
