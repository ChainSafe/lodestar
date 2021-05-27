import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {altair, phase0 as phase0Types} from "@chainsafe/lodestar-types";
import {List} from "@chainsafe/ssz";
import {assert} from "@chainsafe/lodestar-utils";
import * as phase0 from "../../phase0";
import {processSyncCommittee} from "./sync_committee";
import {processAttesterSlashing} from "./attesterSlashing";
import {processProposerSlashing} from "./proposerSlashing";
import {processAttestation} from "./attestation";
import {processDeposit} from "./deposit";
import {
  MAX_ATTESTATIONS,
  MAX_ATTESTER_SLASHINGS,
  MAX_DEPOSITS,
  MAX_PROPOSER_SLASHINGS,
  MAX_VOLUNTARY_EXITS,
} from "@chainsafe/lodestar-params";

export function processBlock(
  config: IBeaconConfig,
  state: altair.BeaconState & phase0Types.BeaconState,
  block: altair.BeaconBlock,
  verifySignatures = true
): void {
  phase0.processBlockHeader(config, state, block);
  phase0.processRandao(state, block.body);
  phase0.processEth1Data(state, block.body);
  processOperations(config, state, block.body, verifySignatures);
  processSyncCommittee(config, state, block.body.syncAggregate, verifySignatures);
}

type Operation =
  | phase0Types.ProposerSlashing
  | phase0Types.AttesterSlashing
  | phase0Types.Attestation
  | phase0Types.Deposit
  | phase0Types.SignedVoluntaryExit;

export function processOperations(
  config: IBeaconConfig,
  state: altair.BeaconState & phase0Types.BeaconState,
  body: altair.BeaconBlockBody,
  verifySignatures = true
): void {
  // Verify that outstanding deposits are processed up to the maximum number of deposits
  assert.true(
    body.deposits.length === Math.min(MAX_DEPOSITS, state.eth1Data.depositCount - state.eth1DepositIndex),
    "Outstanding deposits are not processed"
  );

  const operationsData: {
    operations: List<Operation>;
    maxOperations: number;

    func: (
      config: IBeaconConfig,
      state: altair.BeaconState & phase0Types.BeaconState,
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      operation: any,
      verifySignatures: boolean
    ) => void;
    verifySignatures: boolean;
  }[] = [
    {
      operations: body.proposerSlashings,
      maxOperations: MAX_PROPOSER_SLASHINGS,
      func: processProposerSlashing,
      verifySignatures,
    },
    {
      operations: body.attesterSlashings,
      maxOperations: MAX_ATTESTER_SLASHINGS,
      func: processAttesterSlashing,
      verifySignatures,
    },
    {
      operations: body.attestations,
      maxOperations: MAX_ATTESTATIONS,
      func: processAttestation,
      verifySignatures,
    },
    {
      operations: body.deposits,
      maxOperations: MAX_DEPOSITS,
      func: processDeposit,
      verifySignatures,
    },
    {
      operations: body.voluntaryExits,
      maxOperations: MAX_VOLUNTARY_EXITS,
      func: phase0.processVoluntaryExit,
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
