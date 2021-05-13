import {List} from "@chainsafe/ssz";
import {phase0} from "@chainsafe/lodestar-types";
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
  | phase0.ProposerSlashing
  | phase0.AttesterSlashing
  | phase0.Attestation
  | phase0.Deposit
  | phase0.SignedVoluntaryExit;

export function processOperations(
  config: IBeaconConfig,
  state: phase0.BeaconState,
  body: phase0.BeaconBlockBody,
  verifySignatures = true
): void {
  // Verify that outstanding deposits are processed up to the maximum number of deposits
  assert.true(
    body.deposits.length === Math.min(config.params.MAX_DEPOSITS, state.eth1Data.depositCount - state.eth1DepositIndex),
    "Outstanding deposits are not processed"
  );

  const operationsData: {
    operations: List<Operation>;
    maxOperations: number;
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    func: (config: IBeaconConfig, state: phase0.BeaconState, operation: any, verifySignatures: boolean) => void;
    verifySignatures: boolean;
  }[] = [
    {
      operations: body.proposerSlashings,
      maxOperations: config.params.MAX_PROPOSER_SLASHINGS,
      func: processProposerSlashing,
      verifySignatures,
    },
    {
      operations: body.attesterSlashings,
      maxOperations: config.params.MAX_ATTESTER_SLASHINGS,
      func: processAttesterSlashing,
      verifySignatures,
    },
    {
      operations: body.attestations,
      maxOperations: config.params.MAX_ATTESTATIONS,
      func: processAttestation,
      verifySignatures,
    },
    {
      operations: body.deposits,
      maxOperations: config.params.MAX_DEPOSITS,
      func: processDeposit,
      verifySignatures,
    },
    {
      operations: body.voluntaryExits,
      maxOperations: config.params.MAX_VOLUNTARY_EXITS,
      func: processVoluntaryExit,
      verifySignatures,
    },
  ];

  for (const {operations, maxOperations, func, verifySignatures} of operationsData) {
    assert.lte(operations.length, maxOperations, "Too many operations");
    for (const operation of operations) {
      func(config, state, operation, verifySignatures);
    }
  }
}
