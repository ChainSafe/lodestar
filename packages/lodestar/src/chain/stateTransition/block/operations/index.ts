import assert from "assert";
import {
  MAX_ATTESTATIONS,
  MAX_ATTESTER_SLASHINGS,
  MAX_DEPOSITS,
  MAX_PROPOSER_SLASHINGS, MAX_TRANSFERS,
  MAX_VOLUNTARY_EXITS
} from "@chainsafe/eth2-types";
import {
  BeaconBlockBody, BeaconState, ProposerSlashing, AttesterSlashing, Attestation,
  Deposit, VoluntaryExit, Transfer,
} from "@chainsafe/eth2-types";

import {processProposerSlashing} from "./proposerSlashing";
import {processAttesterSlashing} from "./attesterSlashing";
import {processAttestation} from "./attestation";
import {processDeposit} from "./deposit";
import {processVoluntaryExit} from "./voluntaryExit";
import {processTransfer} from "./transfer";

export {
  processProposerSlashing,
  processAttesterSlashing,
  processAttestation,
  processDeposit,
  processVoluntaryExit,
  processTransfer,
};

// See https://github.com/ethereum/eth2.0-specs/blob/v0.7.1/specs/core/0_beacon-chain.md#operations

type Operation =
  ProposerSlashing | AttesterSlashing | Attestation | Deposit | VoluntaryExit | Transfer;

export function processOperations(state: BeaconState, body: BeaconBlockBody): void {
  // Verify that outstanding deposits are processed up to the maximum number of deposits
  assert(body.deposits.length == Math.min(MAX_DEPOSITS,
    state.latestEth1Data.depositCount - state.depositIndex));
  // Verify that there are no duplicate transfers
  assert(body.transfers.length == (new Set(body.transfers)).size);
  [{
    operations: body.proposerSlashings,
    maxOperations: MAX_PROPOSER_SLASHINGS,
    func: processProposerSlashing
  }, {
    operations: body.attesterSlashings,
    maxOperations:MAX_ATTESTER_SLASHINGS,
    func: processAttesterSlashing
  }, {
    operations: body.attestations,
    maxOperations:MAX_ATTESTATIONS,
    func: processAttestation
  }, {
    operations: body.deposits,
    maxOperations: MAX_DEPOSITS,
    func: processDeposit
  }, {
    operations: body.voluntaryExits,
    maxOperations: MAX_VOLUNTARY_EXITS,
    func: processVoluntaryExit
  }, {
    operations: body.transfers,
    maxOperations: MAX_TRANSFERS,
    func: processTransfer
  }].forEach(({
    operations,
    maxOperations,
    func
  }: {
    operations: Operation[];
    maxOperations: number;
    func: (state: BeaconState, operation: Operation) => void;
  })=>{
    assert(operations.length <= maxOperations);
    operations.forEach((operation) => {
      func(state, operation);
    });
  });
}
