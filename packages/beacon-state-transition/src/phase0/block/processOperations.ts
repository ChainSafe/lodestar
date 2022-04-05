import {phase0} from "@chainsafe/lodestar-types";
import {MAX_DEPOSITS} from "@chainsafe/lodestar-params";

import {CachedBeaconStatePhase0} from "../../types";
import {processProposerSlashing} from "./processProposerSlashing";
import {processAttesterSlashing} from "./processAttesterSlashing";
import {processAttestation} from "./processAttestation";
import {processDeposit} from "./processDeposit";
import {processVoluntaryExit} from "./processVoluntaryExit";

export function processOperations(
  state: CachedBeaconStatePhase0,
  body: phase0.BeaconBlockBody,
  verifySignatures = true
): void {
  // verify that outstanding deposits are processed up to the maximum number of deposits
  const maxDeposits = Math.min(MAX_DEPOSITS, state.eth1Data.depositCount - state.eth1DepositIndex);
  if (body.deposits.length !== maxDeposits) {
    throw new Error(
      `Block contains incorrect number of deposits: depositCount=${body.deposits.length} expected=${maxDeposits}`
    );
  }

  for (const proposerSlashing of body.proposerSlashings) {
    processProposerSlashing(state, proposerSlashing, verifySignatures);
  }
  for (const attesterSlashing of body.attesterSlashings) {
    processAttesterSlashing(state, attesterSlashing, verifySignatures);
  }
  for (const attestation of body.attestations) {
    processAttestation(state, attestation, verifySignatures);
  }
  for (const deposit of body.deposits) {
    processDeposit(state, deposit);
  }
  for (const voluntaryExit of body.voluntaryExits) {
    processVoluntaryExit(state, voluntaryExit, verifySignatures);
  }
}
