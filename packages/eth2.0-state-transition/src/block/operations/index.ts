import assert from "assert";
import {
  Attestation,
  AttesterSlashing,
  BeaconBlockBody,
  BeaconState,
  Deposit,
  ProposerSlashing,
  VoluntaryExit,
} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {processProposerSlashing} from "./proposerSlashing";
import {processAttesterSlashing} from "./attesterSlashing";
import {processAttestation} from "./attestation";
import {processDeposit} from "./deposit";
import {processVoluntaryExit} from "./voluntaryExit";


export * from "./proposerSlashing";
export * from "./attesterSlashing";
export * from "./attestation";
export * from "./deposit";
export * from "./voluntaryExit";

// See https://github.com/ethereum/eth2.0-specs/blob/v0.8.1/specs/core/0_beacon-chain.md#operations

type Operation =
  ProposerSlashing | AttesterSlashing | Attestation | Deposit | VoluntaryExit;

export function processOperations(
  config: IBeaconConfig,
  state: BeaconState,
  body: BeaconBlockBody
): void {
  // Verify that outstanding deposits are processed up to the maximum number of deposits
  assert.equal(body.deposits.length, Math.min(
    config.params.MAX_DEPOSITS,
    state.eth1Data.depositCount - state.eth1DepositIndex));
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
  }].forEach(({
    operations,
    maxOperations,
    func
  }: {
    operations: Operation[];
    maxOperations: number;
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    func: (config: IBeaconConfig, state: BeaconState, operation: any) => void;
  })=>{
    assert(operations.length <= maxOperations);
    operations.forEach((operation) => {
      func(config, state, operation);
    });
  });
}
