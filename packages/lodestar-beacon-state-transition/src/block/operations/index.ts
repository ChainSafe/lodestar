import {List} from "@chainsafe/ssz";
import {
  Attestation,
  AttesterSlashing,
  BeaconBlockBody,
  BeaconState,
  Deposit,
  ProposerSlashing,
  SignedVoluntaryExit,
} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {assert} from "@chainsafe/lodestar-utils";

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

type Operation =
  ProposerSlashing | AttesterSlashing | Attestation | Deposit | SignedVoluntaryExit;

export function processOperations(
  config: IBeaconConfig,
  state: BeaconState,
  body: BeaconBlockBody,
  verifySignatures = true,
): void {
  // Verify that outstanding deposits are processed up to the maximum number of deposits
  assert(body.deposits.length === Math.min(
    config.params.MAX_DEPOSITS,
    state.eth1Data.depositCount - state.eth1DepositIndex));
  [{
    operations: body.proposerSlashings,
    maxOperations: config.params.MAX_PROPOSER_SLASHINGS,
    func: processProposerSlashing,
    verifySignatures,
  }, {
    operations: body.attesterSlashings,
    maxOperations: config.params.MAX_ATTESTER_SLASHINGS,
    func: processAttesterSlashing,
    verifySignatures,
  }, {
    operations: body.attestations,
    maxOperations: config.params.MAX_ATTESTATIONS,
    func: processAttestation,
    verifySignatures,
  }, {
    operations: body.deposits,
    maxOperations: config.params.MAX_DEPOSITS,
    func: processDeposit,
    verifySignatures,
  }, {
    operations: body.voluntaryExits,
    maxOperations: config.params.MAX_VOLUNTARY_EXITS,
    func: processVoluntaryExit,
    verifySignatures,
  }].forEach(({
    operations,
    maxOperations,
    func,
    verifySignatures,
  }: {
    operations: List<Operation>;
    maxOperations: number;
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    func: (config: IBeaconConfig, state: BeaconState, operation: any, verifySignatures: boolean) => void;
    verifySignatures: boolean;
  }) => {
    assert(operations.length <= maxOperations);
    operations.forEach((operation) => {
      func(config, state, operation, verifySignatures);
    });
  });
}
