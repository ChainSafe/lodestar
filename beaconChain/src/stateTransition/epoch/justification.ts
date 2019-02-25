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
  state.justificationBitfield = state.justificationBitfield.or(new BN(2));
  if (previousEpochBoundaryAttestingBalance.muln(3) >= previousTotalBalance.muln(2)) {
    newJustifiedEpoch = previousEpoch
  }
  state.justificationBitfield = state.justificationBitfield.or(new BN(1));
  if (currentEpochBoundaryAttestingBalance.muln(3) >= currentTotalBalance.muln(2)) {
    newJustifiedEpoch = currentEpoch;
  }

  // Update last finalized epoch if possible
  if (state.justificationBitfield.shln(1).modn(8) === 0b111 && state.previousJustifiedEpoch === previousEpoch.subn(2)) {
    state.finalizedEpoch = state.previousJustifiedEpoch;
  }
  if (state.justificationBitfield.shln(1).modn(4) === 0b11 && state.previousJustifiedEpoch === previousEpoch.subn(1)) {
    state.finalizedEpoch = state.previousJustifiedEpoch;
  }
  if (state.justificationBitfield.shln(0).modn(8) === 0b111 && state.justifiedEpoch === previousEpoch.subn(1)) {
    state.finalizedEpoch = state.justifiedEpoch;
  }
  if (state.justificationBitfield.ishln(0).modn(4) === 0b11 && state.justifiedEpoch === previousEpoch) {
    state.finalizedEpoch = state.justifiedEpoch;
  }
  state.previousJustifiedEpoch = state.justifiedEpoch;
  state.justifiedEpoch = newJustifiedEpoch;
}
