import {allForks, capella} from "@lodestar/types";
import {ForkSeq, MAX_DEPOSITS} from "@lodestar/params";

import {CachedBeaconStateAllForks, CachedBeaconStateCapella} from "../types.js";
import {processAttestations} from "./process_attestations.js";
import {processProposerSlashing} from "./process_proposer_slashing.js";
import {processAttesterSlashing} from "./process_attester_slashing.js";
import {processDeposit} from "./process_deposit.js";
import {processVoluntaryExit} from "./process_voluntary_exit.js";
import {processBlsToExecutionChange} from "./process_bls_to_execution_change.js";
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
