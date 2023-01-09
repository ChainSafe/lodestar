import {allForks, capella} from "@lodestar/types";
import {ForkSeq, MAX_DEPOSITS} from "@lodestar/params";

import {CachedBeaconStateAllForks, CachedBeaconStateCapella} from "../types.js";
import {processAttestations} from "./processAttestations.js";
import {processProposerSlashing} from "./processProposerSlashing.js";
import {processAttesterSlashing} from "./processAttesterSlashing.js";
import {processDeposit} from "./processDeposit.js";
import {processVoluntaryExit} from "./processVoluntaryExit.js";
import {processBlsToExecutionChange} from "./processBlsToExecutionChange.js";
import {ProcessBlockOpts} from "./types.js";

export {
  processProposerSlashing,
  processAttesterSlashing,
  processAttestations,
  processDeposit,
  processVoluntaryExit,
  processBlsToExecutionChange,
};

export function processOperations(
  fork: ForkSeq,
  state: CachedBeaconStateAllForks,
  body: allForks.BeaconBlockBody,
  opts: ProcessBlockOpts = {verifySignatures: true}
): void {
  // verify that outstanding deposits are processed up to the maximum number of deposits
  const maxDeposits = Math.min(MAX_DEPOSITS, state.eth1Data.depositCount - state.eth1DepositIndex);
  if (body.deposits.length !== maxDeposits) {
    throw new Error(
      `Block contains incorrect number of deposits: depositCount=${body.deposits.length} expected=${maxDeposits}`
    );
  }

  for (const proposerSlashing of body.proposerSlashings) {
    processProposerSlashing(fork, state, proposerSlashing, opts.verifySignatures);
  }
  for (const attesterSlashing of body.attesterSlashings) {
    processAttesterSlashing(fork, state, attesterSlashing, opts.verifySignatures);
  }

  processAttestations(fork, state, body.attestations, opts.verifySignatures);

  for (const deposit of body.deposits) {
    processDeposit(fork, state, deposit);
  }
  for (const voluntaryExit of body.voluntaryExits) {
    processVoluntaryExit(state, voluntaryExit, opts.verifySignatures);
  }

  if (fork >= ForkSeq.capella) {
    for (const blsToExecutionChange of (body as capella.BeaconBlockBody).blsToExecutionChanges) {
      processBlsToExecutionChange(state as CachedBeaconStateCapella, blsToExecutionChange);
    }
  }
}
