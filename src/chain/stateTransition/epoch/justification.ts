/**
 * @module chain/stateTransition/epoch
 */

import BN from "bn.js";

import {BeaconState} from "../../../types";

import {
  getBlockRoot,
  //TODO unused import
  //getEpochStartSlot,
  getCurrentEpoch,
  getPreviousEpoch
} from "../util";

import {getTotalActiveBalance, getAttestingBalance, getMatchingTargetAttestations} from "./util";


export function processJustificationAndFinalization(state: BeaconState): void {
  const previousEpoch = getPreviousEpoch(state);
  const currentEpoch = getCurrentEpoch(state);
  const oldPreviousJustifiedEpoch = state.previousJustifiedEpoch;
  const oldCurrentJustifiedEpoch = state.currentJustifiedEpoch;

  // Process justifications
  state.previousJustifiedEpoch = oldCurrentJustifiedEpoch;
  state.previousJustifiedRoot = state.currentJustifiedRoot;
  // Rotate the justification bitfield up one epoch to make room for the current epoch
  state.justificationBitfield = state.justificationBitfield.shln(1)
    .mod((new BN(2)).pow(new BN(64)));
  const totalActiveBalance = getTotalActiveBalance(state);
  const justifiedRoot = getBlockRoot(state, oldCurrentJustifiedEpoch);

  // If the previous epoch gets justified, fill the second last bit
  const previousEpochMatchingTargetBalance =
    getAttestingBalance(state, getMatchingTargetAttestations(state, previousEpoch));
  if (previousEpochMatchingTargetBalance.muln(3).gte(totalActiveBalance.muln(2))) {
    state.currentJustifiedEpoch = previousEpoch;
    state.currentJustifiedRoot = justifiedRoot;
    state.justificationBitfield = state.justificationBitfield.or(new BN(2));
  }
  // If the current epoch gets justified, fill the last bit
  const currentEpochMatchingTargetBalance =
    getAttestingBalance(state, getMatchingTargetAttestations(state, currentEpoch));
  if (currentEpochMatchingTargetBalance.muln(3).gte(totalActiveBalance.muln(2))) {
    state.currentJustifiedEpoch = currentEpoch;
    state.currentJustifiedRoot = justifiedRoot;
    state.justificationBitfield = state.justificationBitfield.or(new BN(1));
  }

  const finalizedRoot = getBlockRoot(state, state.finalizedEpoch);

  // Process finalizations
  // The 2nd/3rd/4th most recent epochs are all justified, the 2nd using the 4th as source
  if (state.justificationBitfield.shrn(1)
    .modn(8) === 0b111 && oldPreviousJustifiedEpoch === currentEpoch - 3) {
    state.finalizedEpoch = oldPreviousJustifiedEpoch;
    state.finalizedRoot = finalizedRoot;
  }
  // The 2nd/3rd most recent epochs are both justified, the 2nd using the 3rd as source
  if (state.justificationBitfield.shrn(1)
    .modn(4) === 0b11 && oldPreviousJustifiedEpoch === currentEpoch - 2) {
    state.finalizedEpoch = oldPreviousJustifiedEpoch;
    state.finalizedRoot = finalizedRoot;
  }
  // The 1st/2nd/3rd most recent epochs are all justified, the 1st using the 3rd as source
  if (state.justificationBitfield.shrn(0)
    .modn(8) === 0b111 && oldCurrentJustifiedEpoch === currentEpoch - 2) {
    state.finalizedEpoch = oldCurrentJustifiedEpoch;
    state.finalizedRoot = finalizedRoot;
  }
  // The 1st/2nd most recent epochs are both justified, the 1st using the 2nd as source
  if (state.justificationBitfield.shrn(0)
    .modn(4) === 0b11 && oldCurrentJustifiedEpoch === currentEpoch - 1) {
    state.finalizedEpoch = oldCurrentJustifiedEpoch;
    state.finalizedRoot = finalizedRoot;
  }
}
