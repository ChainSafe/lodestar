import {BeaconState, Epoch} from "../../../types";
import BN from "bn.js";

export function processJustification(
  state: BeaconState,
  currentEpoch: Epoch,
  previousEpoch: Epoch,
  previousEpochBoundaryAttestingBalance: BN,
  currentEpochBoundaryAttestingBalance: BN,
  currentTotalBalance: BN,
  previousTotalBalance: BN,
): void {

  let newJustifiedEpoch = state.justifiedEpoch;
  state.justificationBitfield = state.justificationBitfield.shln(1);

  if (previousEpochBoundaryAttestingBalance.muln(3).gte(previousTotalBalance.muln(2))) {
    state.justificationBitfield = state.justificationBitfield.or(new BN(2));
    newJustifiedEpoch = previousEpoch
  }
  if (currentEpochBoundaryAttestingBalance.muln(3).gte(currentTotalBalance.muln(2))) {
    state.justificationBitfield = state.justificationBitfield.or(new BN(1));
    newJustifiedEpoch = currentEpoch;
  }

  // Update last finalized epoch if possible
  if (state.justificationBitfield.shrn(1).modn(8) === 0b111 && state.previousJustifiedEpoch === previousEpoch - 2) {
    state.finalizedEpoch = state.previousJustifiedEpoch;
  }
  if (state.justificationBitfield.shrn(1).modn(4) === 0b11 && state.previousJustifiedEpoch === previousEpoch - 1) {
    state.finalizedEpoch = state.previousJustifiedEpoch;
  }
  if (state.justificationBitfield.shrn(0).modn(8) === 0b111 && state.justifiedEpoch === previousEpoch - 1) {
    state.finalizedEpoch = state.justifiedEpoch;
  }
  if (state.justificationBitfield.shrn(0).modn(4) === 0b11 && state.justifiedEpoch === previousEpoch) {
    state.finalizedEpoch = state.justifiedEpoch;
  }
  state.previousJustifiedEpoch = state.justifiedEpoch;
  state.justifiedEpoch = newJustifiedEpoch;
}
