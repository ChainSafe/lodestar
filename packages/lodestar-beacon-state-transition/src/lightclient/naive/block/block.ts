import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {lightclient, phase0 as phase0Types} from "@chainsafe/lodestar-types";
import {phase0} from "../../..";
import {processSyncCommittee} from "..";
import {processAttesterSlashing} from "./attesterSlashing";
import {processProposerSlashing} from "./proposerSlashing";
import {List} from "@chainsafe/ssz";
import {assert} from "@chainsafe/lodestar-utils";
import {processAttestation} from "./attestation";
import {processDeposit} from "./deposit";

export function processBlock(
  config: IBeaconConfig,
  state: lightclient.BeaconState & phase0Types.BeaconState,
  block: lightclient.BeaconBlock,
  verifySignatures = true
): void {
  phase0.processBlockHeader(config, state, block);
  phase0.processRandao(config, state, block.body);
  phase0.processEth1Data(config, state, block.body);
  processOperations(config, state, block.body, verifySignatures);
  processSyncCommittee(config, state, block, verifySignatures);
}

type Operation =
  | phase0.ProposerSlashing
  | phase0.AttesterSlashing
  | phase0.Attestation
  | phase0.Deposit
  | phase0.SignedVoluntaryExit;

export function processOperations(
  config: IBeaconConfig,
  state: lightclient.BeaconState & phase0Types.BeaconState,
  body: lightclient.BeaconBlockBody,
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

    func: (
      config: IBeaconConfig,
      state: lightclient.BeaconState & phase0Types.BeaconState,
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      operation: any,
      verifySignatures: boolean
    ) => void;
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
