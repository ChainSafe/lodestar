/**
 * @module chain/stateTransition/epoch
 */

import BN from "bn.js";

import {BeaconState} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {GENESIS_EPOCH} from "../../../constants";
import {getBlockRoot, getCurrentEpoch, getPreviousEpoch, getTotalActiveBalance} from "../util";

import {getAttestingBalance, getMatchingTargetAttestations} from "./util";


export function processJustificationAndFinalization(
  config: IBeaconConfig,
  state: BeaconState
): void {
  const currentEpoch = getCurrentEpoch(config, state);
  if(currentEpoch <= GENESIS_EPOCH + 1) {
    return;
  }
  const previousEpoch = getPreviousEpoch(config, state);
  const oldPreviousJustifiedCheckpoint = state.previousJustifiedCheckpoint;
  const oldCurrentJustifiedCheckpoint = state.currentJustifiedCheckpoint;

  // Process justifications
  state.previousJustifiedCheckpoint = state.currentJustifiedCheckpoint;
  // Rotate the justification bitfield up one epoch to make room for the current epoch
  state.justificationBits.push(false);
  const totalActiveBalance = getTotalActiveBalance(config, state);

  // If the previous epoch gets justified, fill the second last bit
  const previousEpochMatchingTargetBalance =
    getAttestingBalance(config, state, getMatchingTargetAttestations(config, state, previousEpoch));
  if (previousEpochMatchingTargetBalance.muln(3).gte(totalActiveBalance.muln(2))) {
    state.currentJustifiedCheckpoint = {
      epoch: previousEpoch,
      root: getBlockRoot(config, state, previousEpoch),
    };
    state.justificationBits.setBit(1, true);
  }
  // If the current epoch gets justified, fill the last bit
  const currentEpochMatchingTargetBalance =
    getAttestingBalance(config, state, getMatchingTargetAttestations(config, state, currentEpoch));
  if (currentEpochMatchingTargetBalance.muln(3).gte(totalActiveBalance.muln(2))) {
    state.currentJustifiedCheckpoint = {
      epoch: currentEpoch,
      root: getBlockRoot(config, state, currentEpoch),
    };
    state.justificationBits.setBit(0, true);
  }

  const bits = state.justificationBits;

  // Process finalizations
  // The 2nd/3rd/4th most recent epochs are all justified, the 2nd using the 4th as source
  if (
    bits.getBit(1) && bits.getBit(2) && bits.getBit(3) &&
    oldPreviousJustifiedCheckpoint.epoch + 3 === currentEpoch
  ) {
    state.finalizedCheckpoint = oldPreviousJustifiedCheckpoint;
  }
  // The 2nd/3rd most recent epochs are both justified, the 2nd using the 3rd as source
  if (
    bits.getBit(1) && bits.getBit(2) &&
    oldPreviousJustifiedCheckpoint.epoch + 2 === currentEpoch
  ) {
    state.finalizedCheckpoint = oldPreviousJustifiedCheckpoint;
  }
  // The 1st/2nd/3rd most recent epochs are all justified, the 1st using the 3rd as source
  if (
    bits.getBit(0) && bits.getBit(1) && bits.getBit(2) &&
    oldCurrentJustifiedCheckpoint.epoch + 2 === currentEpoch
  ) {
    state.finalizedCheckpoint = oldCurrentJustifiedCheckpoint;
  }
  // The 1st/2nd most recent epochs are both justified, the 1st using the 2nd as source
  if (
    bits.getBit(0) && bits.getBit(1) &&
    oldCurrentJustifiedCheckpoint.epoch + 1 === currentEpoch
  ) {
    state.finalizedCheckpoint = oldCurrentJustifiedCheckpoint;
  }
}
