import BN from "bn.js";
import {hashTreeRoot} from "@chainsafe/ssz";
import {BeaconState, Epoch, PendingAttestation, ValidatorIndex} from "../../../types";
import {getActiveValidatorIndices, getRandaoMix, slotToEpoch} from "../../helpers/stateTransitionHelpers";
import {
  ACTIVATION_EXIT_DELAY, LATEST_ACTIVE_INDEX_ROOTS_LENGTH, LATEST_RANDAO_MIXES_LENGTH,
  LATEST_SLASHED_EXIT_LENGTH
} from "../../../constants";

export function processFinalUpdates(
  state: BeaconState,
  currentEpoch: Epoch,
  nextEpoch: Epoch): void {

  state.latestActiveIndexRoots[nextEpoch.addn(ACTIVATION_EXIT_DELAY).modn(LATEST_ACTIVE_INDEX_ROOTS_LENGTH)] = hashTreeRoot(getActiveValidatorIndices(state.validatorRegistry, nextEpoch.addn(ACTIVATION_EXIT_DELAY)), [ValidatorIndex]);
  state.latestSlashedBalances[nextEpoch.modn(LATEST_SLASHED_EXIT_LENGTH)] = state.latestSlashedBalances[currentEpoch.modn(LATEST_SLASHED_EXIT_LENGTH)];
  state.latestRandaoMixes[nextEpoch.modn(LATEST_RANDAO_MIXES_LENGTH)] = getRandaoMix(state, currentEpoch);
  state.latestAttestations = state.latestAttestations.filter((attestation: PendingAttestation) => slotToEpoch(attestation.data.slot).lt(new BN(currentEpoch)));
}
