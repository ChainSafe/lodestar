import {BeaconDB} from "../../../db/api";
import {AttestationData, BeaconBlock, BeaconState, Crosslink, Shard} from "../../../types";
import {getBlockRoot, getCurrentEpoch, getEpochStartSlot} from "../../stateTransition/util";
import {ZERO_HASH} from "../../../constants";
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
    beaconBlockRoot: signingRoot(headBlock, BeaconBlock),
    crosslinkDataRoot: ZERO_HASH,
    previousCrosslinkRoot: hashTreeRoot(headState.currentCrosslinks[shard], Crosslink),
    shard,
    sourceEpoch: headState.currentJustifiedEpoch,
    sourceRoot: headState.currentJustifiedRoot,
    targetEpoch: currentEpoch,
    targetRoot: signingRoot(epochBoundaryBlock, BeaconBlock)
  };
}
