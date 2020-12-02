import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Phase1} from "@chainsafe/lodestar-types";
import {assert} from "@chainsafe/lodestar-utils";
import {processAttesterSlashing, processDeposit, processProposerSlashing, processVoluntaryExit} from "../../..";
import {processAttestation} from "./attestation";
import {processShardTransitions} from "../../shard";

export * from "./attestation";

export function processOperations(config: IBeaconConfig, state: Phase1.BeaconState, block: Phase1.BeaconBlock): void {
  // Verify that outstanding deposits are processed up to the maximum number of deposits
  assert.true(
    block.body.deposits.length ===
      Math.min(config.params.MAX_DEPOSITS, state.eth1Data.depositCount - state.eth1DepositIndex),
    "Outstanding deposits are not processed"
  );

  [
    {
      operations: block.body.proposerSlashings,
      maxOperations: config.params.MAX_PROPOSER_SLASHINGS,
      func: processProposerSlashing,
      verifySignatures: true,
    },
    {
      operations: block.body.attesterSlashings,
      maxOperations: config.params.MAX_ATTESTER_SLASHINGS,
      func: processAttesterSlashing,
      verifySignatures: true,
    },
    {
      operations: block.body.attestations,
      maxOperations: config.params.MAX_ATTESTATIONS,
      func: processAttestation,
      verifySignatures: true,
    },
    {
      operations: block.body.deposits,
      maxOperations: config.params.MAX_DEPOSITS,
      func: processDeposit,
      verifySignatures: true,
    },
    {
      operations: block.body.voluntaryExits,
      maxOperations: config.params.MAX_VOLUNTARY_EXITS,
      func: processVoluntaryExit,
      verifySignatures: true,
    },
  ].forEach(({operations, maxOperations, func, verifySignatures}) => {
    assert.lte(operations.length, maxOperations, "Too many operations");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    operations.forEach((operation: any) => {
      func(config, state, operation, verifySignatures);
    });
  });

  //process_custody_game_operations
  processShardTransitions(config, state, Array.from(block.body.shardTransitions), Array.from(block.body.attestations));
}
