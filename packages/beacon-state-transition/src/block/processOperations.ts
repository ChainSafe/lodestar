import {allForks} from "@chainsafe/lodestar-types";
import {ForkSeq, MAX_DEPOSITS} from "@chainsafe/lodestar-params";

import {CachedBeaconStateAllForks, CachedBeaconStateAltair, CachedBeaconStatePhase0} from "../types.js";
import {processAttestationsAltair} from "./processAttestationsAltair.js";
import {processAttestationPhase0} from "./processAttestationPhase0.js";
import {processProposerSlashing} from "./processProposerSlashing.js";
import {processAttesterSlashing} from "./processAttesterSlashing.js";
import {processDeposit} from "./processDeposit.js";
import {processVoluntaryExit} from "./processVoluntaryExit.js";

export function processOperations(
  fork: ForkSeq,
  state: CachedBeaconStateAllForks,
  body: allForks.BeaconBlockBody,
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
    processProposerSlashing(fork, state, proposerSlashing, verifySignatures);
  }
  for (const attesterSlashing of body.attesterSlashings) {
    processAttesterSlashing(fork, state, attesterSlashing, verifySignatures);
  }
  if (fork === ForkSeq.phase0) {
    for (const attestation of body.attestations) {
      processAttestationPhase0(state as CachedBeaconStatePhase0, attestation, verifySignatures);
    }
  } else {
    processAttestationsAltair(state as CachedBeaconStateAltair, body.attestations, verifySignatures);
  }
  for (const deposit of body.deposits) {
    processDeposit(fork, state, deposit);
  }
  for (const voluntaryExit of body.voluntaryExits) {
    processVoluntaryExit(state, voluntaryExit, verifySignatures);
  }
}
