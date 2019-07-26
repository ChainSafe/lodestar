import assert from "assert";
import {
  BeaconBlockBody, BeaconState, ProposerSlashing, AttesterSlashing, Attestation,
  Deposit, VoluntaryExit, Transfer,
} from "../../../../types";
import {IBeaconConfig} from "../../../../config";

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

// See https://github.com/ethereum/eth2.0-specs/blob/v0.8.1/specs/core/0_beacon-chain.md#operations

type Operation =
  ProposerSlashing | AttesterSlashing | Attestation | Deposit | VoluntaryExit | Transfer;

export function processOperations(
  config: IBeaconConfig,
  state: BeaconState,
  body: BeaconBlockBody
): void {
  // Verify that outstanding deposits are processed up to the maximum number of deposits
  assert(body.deposits.length == Math.min(
    config.params.MAX_DEPOSITS,
    state.eth1Data.depositCount - state.eth1DepositIndex));
  // Verify that there are no duplicate transfers
  // TODO this is not sufficient to determine duplicates
  assert(body.transfers.length == (new Set(body.transfers)).size);
  [{
    operations: body.proposerSlashings,
    maxOperations: config.params.MAX_PROPOSER_SLASHINGS,
    func: processProposerSlashing
  }, {
    operations: body.attesterSlashings,
    maxOperations: config.params.MAX_ATTESTER_SLASHINGS,
    func: processAttesterSlashing
  }, {
    operations: body.attestations,
    maxOperations: config.params.MAX_ATTESTATIONS,
    func: processAttestation
  }, {
    operations: body.deposits,
    maxOperations: config.params.MAX_DEPOSITS,
    func: processDeposit
  }, {
    operations: body.voluntaryExits,
    maxOperations: config.params.MAX_VOLUNTARY_EXITS,
    func: processVoluntaryExit
  }, {
    operations: body.transfers,
    maxOperations: config.params.MAX_TRANSFERS,
    func: processTransfer
  }].forEach(({
    operations,
    maxOperations,
    func
  }: {
    operations: Operation[];
    maxOperations: number;
    func: (config: IBeaconConfig, state: BeaconState, operation: Operation) => void;
  })=>{
    assert(operations.length <= maxOperations);
    operations.forEach((operation) => {
      func(config, state, operation);
    });
  });
}
