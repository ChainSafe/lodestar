import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Phase1} from "@chainsafe/lodestar-types";
import {validateAttestation} from "../validation";
import {getBeaconProposerIndex} from "../../../util/proposer";
import {getCurrentEpoch} from "../../../util";
export function processAttestation(
  config: IBeaconConfig,
  state: Phase1.BeaconState,
  attestation: Phase1.Attestation
): void {
  validateAttestation(config, state, attestation);
  const pendingAttestation: Phase1.PendingAttestation = {
    aggregationBits: attestation.aggregationBits,
    data: attestation.data,
    inclusionDelay: state.slot - attestation.data.slot,
    proposerIndex: getBeaconProposerIndex(config, state),
    crosslinkSuccess: true,
  };
  if (attestation.data.target.epoch == getCurrentEpoch(config, state)) {
    state.currentEpochAttestations.push(pendingAttestation);
  } else {
    state.previousEpochAttestations.push(pendingAttestation);
  }
}
