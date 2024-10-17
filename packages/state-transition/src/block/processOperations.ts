import {BeaconBlockBody, capella, electra} from "@lodestar/types";
import {ForkSeq} from "@lodestar/params";

import {CachedBeaconStateAllForks, CachedBeaconStateCapella, CachedBeaconStateElectra} from "../types.js";
import {getEth1DepositCount} from "../util/deposit.js";
import {processAttestations} from "./processAttestations.js";
import {processProposerSlashing} from "./processProposerSlashing.js";
import {processAttesterSlashing} from "./processAttesterSlashing.js";
import {processDeposit} from "./processDeposit.js";
import {processVoluntaryExit} from "./processVoluntaryExit.js";
import {processBlsToExecutionChange} from "./processBlsToExecutionChange.js";
import {processWithdrawalRequest} from "./processWithdrawalRequest.js";
import {processDepositRequest} from "./processDepositRequest.js";
import {ProcessBlockOpts} from "./types.js";
import {processConsolidationRequest} from "./processConsolidationRequest.js";

export {
  processProposerSlashing,
  processAttesterSlashing,
  processAttestations,
  processDeposit,
  processVoluntaryExit,
  processWithdrawalRequest,
  processBlsToExecutionChange,
  processDepositRequest,
  processConsolidationRequest,
};

export function processOperations(
  fork: ForkSeq,
  state: CachedBeaconStateAllForks,
  body: BeaconBlockBody,
  opts: ProcessBlockOpts = {verifySignatures: true}
): void {
  // verify that outstanding deposits are processed up to the maximum number of deposits
  const maxDeposits = getEth1DepositCount(state);
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
    processVoluntaryExit(fork, state, voluntaryExit, opts.verifySignatures);
  }

  if (fork >= ForkSeq.capella) {
    for (const blsToExecutionChange of (body as capella.BeaconBlockBody).blsToExecutionChanges) {
      processBlsToExecutionChange(state as CachedBeaconStateCapella, blsToExecutionChange);
    }
  }

  if (fork >= ForkSeq.electra) {
    const stateElectra = state as CachedBeaconStateElectra;
    const bodyElectra = body as electra.BeaconBlockBody;

    for (const depositRequest of bodyElectra.executionRequests.deposits) {
      processDepositRequest(stateElectra, depositRequest);
    }

    for (const elWithdrawalRequest of bodyElectra.executionRequests.withdrawals) {
      processWithdrawalRequest(fork, stateElectra, elWithdrawalRequest);
    }

    for (const elConsolidationRequest of bodyElectra.executionRequests.consolidations) {
      processConsolidationRequest(stateElectra, elConsolidationRequest);
    }
  }
}
