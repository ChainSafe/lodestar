import {processAttestationInclusion} from "./attestation";
import {BeaconState, Epoch} from "../../../../types";
import BN = require("bn.js");
import {processJustificationAndFinalization} from "./justification";
import {processCrosslinksRewards} from "./crosslinks";
import {processEth1Data} from "../eth1data";

export function processRewardsAndPenalties(
  state: BeaconState,
  currentEpoch: Epoch,
  nextEpoch: Epoch,
  previousEpoch: Epoch,
  previousTotalBalance: BN,
  previousEpochAttesterIndices: BN[],
  previousEpochBoundaryAttesterIndices: BN[],
  previousEpochHeadAttesterIndices: BN[],
  previousEpochAttestingBalance: BN,
  previousEpochBoundaryAttestingBalance: BN,
  previousEpochHeadAttestingBalance: BN,
  baseReward: Function,
  inactivityPenalty: Function): void {

  processJustificationAndFinalization(
    state,
    currentEpoch,
    previousEpoch,
    previousEpochAttesterIndices,
    nextEpoch,
    previousTotalBalance,
    previousEpochBoundaryAttesterIndices,
    previousEpochHeadAttesterIndices,
    previousEpochAttestingBalance,
    previousEpochBoundaryAttestingBalance,
    previousEpochHeadAttestingBalance,
    baseReward,
    inactivityPenalty,
  );

  processAttestationInclusion(
    state,
    previousEpochAttesterIndices,
    baseReward,
  );

  processCrosslinksRewards(
    state,
  )
}
