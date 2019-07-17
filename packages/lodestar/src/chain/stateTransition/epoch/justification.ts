/**
 * @module chain/stateTransition/epoch
 */

import BN from "bn.js";

import {BeaconState} from "@chainsafe/eth2-types";
import {GENESIS_EPOCH} from "../../../constants";
import {IBeaconConfig} from "../../../config";

import {getBlockRoot, getCurrentEpoch, getPreviousEpoch} from "../util";

import {getAttestingBalance, getMatchingTargetAttestations, getTotalActiveBalance} from "./util";


export function processJustificationAndFinalization(
  config: IBeaconConfig,
  state: BeaconState
): void {
  const currentEpoch = getCurrentEpoch(config, state);
  if(currentEpoch <= GENESIS_EPOCH + 1) {
    return;
  }
  const previousEpoch = getPreviousEpoch(config, state);
  const oldPreviousJustifiedEpoch = state.previousJustifiedEpoch;
  const oldCurrentJustifiedEpoch = state.currentJustifiedEpoch;

  // Process justifications
  state.previousJustifiedEpoch = oldCurrentJustifiedEpoch;
  state.previousJustifiedRoot = state.currentJustifiedRoot;
  // Rotate the justification bitfield up one epoch to make room for the current epoch
  state.justificationBitfield = state.justificationBitfield.shln(1)
    .mod((new BN(2)).pow(new BN(64)));
  const totalActiveBalance = getTotalActiveBalance(config, state);

  // If the previous epoch gets justified, fill the second last bit
  const previousEpochMatchingTargetBalance =
    getAttestingBalance(config, state, getMatchingTargetAttestations(config, state, previousEpoch));
  if (previousEpochMatchingTargetBalance.muln(3).gte(totalActiveBalance.muln(2))) {
    state.currentJustifiedEpoch = previousEpoch;
    state.currentJustifiedRoot =  getBlockRoot(config, state, state.currentJustifiedEpoch);
    state.justificationBitfield = state.justificationBitfield.or(new BN(2));
  }
  // If the current epoch gets justified, fill the last bit
  const currentEpochMatchingTargetBalance =
    getAttestingBalance(config, state, getMatchingTargetAttestations(config, state, currentEpoch));
  if (currentEpochMatchingTargetBalance.muln(3).gte(totalActiveBalance.muln(2))) {
    state.currentJustifiedEpoch = currentEpoch;
    state.currentJustifiedRoot = getBlockRoot(config, state, state.currentJustifiedEpoch);
    state.justificationBitfield = state.justificationBitfield.or(new BN(1));
  }

  const bitfield = state.justificationBitfield.clone();

  // Process finalizations
  // The 2nd/3rd/4th most recent epochs are all justified, the 2nd using the 4th as source
  if (bitfield.shrn(1).modn(8) ===
    0b111 && oldPreviousJustifiedEpoch === currentEpoch - 3) {
    state.finalizedEpoch = oldPreviousJustifiedEpoch;
    state.finalizedRoot = getBlockRoot(config, state, state.finalizedEpoch);
  }
  // The 2nd/3rd most recent epochs are both justified, the 2nd using the 3rd as source
  if (bitfield.shrn(1).modn(4) ===
    0b11 && oldPreviousJustifiedEpoch === currentEpoch - 2) {
    state.finalizedEpoch = oldPreviousJustifiedEpoch;
    state.finalizedRoot = getBlockRoot(config, state, state.finalizedEpoch);
  }
  // The 1st/2nd/3rd most recent epochs are all justified, the 1st using the 3rd as source
  if (bitfield.shrn(0).modn(8) ===
    0b111 && oldCurrentJustifiedEpoch === currentEpoch - 2) {
    state.finalizedEpoch = oldCurrentJustifiedEpoch;
    state.finalizedRoot = getBlockRoot(config, state, state.finalizedEpoch);
  }
  // The 1st/2nd most recent epochs are both justified, the 1st using the 2nd as source
  if (bitfield.shrn(0).modn(4) ===
    0b11 && oldCurrentJustifiedEpoch === currentEpoch - 1) {
    state.finalizedEpoch = oldCurrentJustifiedEpoch;
    state.finalizedRoot = getBlockRoot(config, state, state.finalizedEpoch);
  }
}
