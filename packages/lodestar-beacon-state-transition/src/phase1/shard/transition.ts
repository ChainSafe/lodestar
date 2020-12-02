import {Phase1, ValidatorIndex} from "@chainsafe/lodestar-types";
import {assert} from "@chainsafe/lodestar-utils";
import {computeEpochAtSlot, computeSigningRoot, getDomain, getBlockRootAtSlot} from "../../util";
import {computeUpdatedGasprice} from "../misc";
import {computePreviousSlot} from "../misc/slot";
import {getOffsetSlots, getShardProposerIndex} from "../state";
import {getActiveShardCount} from "../state/accessors";
import {optionalAggregateVerify} from "../state/predicates";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

export function applyShardTransition(
  config: IBeaconConfig,
  state: Phase1.BeaconState,
  shard: Phase1.Shard,
  transition: Phase1.ShardTransition
): void {
  assert.gt(state.slot, config.params.phase1.PHASE_1_FORK_SLOT, "State not ready for phase1");
  const offsetSlots = getOffsetSlots(config, state, shard);
  assert.true(
    transition.shardDataRoots.length === transition.shardStates.length &&
      transition.shardStates.length === transition.shardBlockLengths.length &&
      transition.shardBlockLengths.length === offsetSlots.length,
    "ShardTransition elements are not of equal length"
  );
  assert.equal(transition.startSlot, offsetSlots[0]);
  const headers: Phase1.ShardBlockHeader[] = [];
  const proposers: ValidatorIndex[] = [];
  let previousGasPrice = state.shardStates[shard].gasprice;
  let shardParentRoot = state.shardStates[shard].latestBlockRoot;
  offsetSlots.forEach((offsetSlot, index) => {
    const shardBlockLength = transition.shardBlockLengths[index];
    const shardState = transition.shardStates[index];
    assert.equal(shardState.gasprice, computeUpdatedGasprice(config, previousGasPrice, shardBlockLength));
    assert.equal(shardState.slot, offsetSlot);
    const isEmptyProposal = shardBlockLength === BigInt(0);
    if (!isEmptyProposal) {
      const proposalIndex = getShardProposerIndex(config, state, offsetSlot, shard);
      const header: Phase1.ShardBlockHeader = {
        shardParentRoot,
        beaconParentRoot: getBlockRootAtSlot(config, state, offsetSlot),
        slot: offsetSlot,
        shard,
        proposerIndex: proposalIndex,
        bodyRoot: transition.shardDataRoots[index],
      };
      shardParentRoot = config.types.phase1.ShardBlockHeader.hashTreeRoot(header);
      headers.push(header);
      proposers.push(proposalIndex);
    } else {
      assert.true(config.types.Root.equals(transition.shardDataRoots[index], config.types.Root.defaultValue()));
    }
    previousGasPrice = shardState.gasprice;
  });
  const pubkeys = proposers.map((index) => state.validators[index].pubkey);
  const signingRoots = headers.map((header) => {
    return computeSigningRoot(
      config,
      config.types.phase1.ShardBlockHeader,
      header,
      getDomain(config, state, config.params.phase1.DOMAIN_SHARD_PROPOSAL, computeEpochAtSlot(config, header.slot))
    );
  });
  assert.true(optionalAggregateVerify(config, pubkeys, signingRoots, transition.proposerSignatureAggregate));
  const shardState = config.types.phase1.ShardState.clone(transition.shardStates[transition.shardStates.length - 1]);
  shardState.slot = computePreviousSlot(state.slot);
  state.shardStates[shard] = shardState;
}

export function verifyEmptyShardTransition(
  config: IBeaconConfig,
  state: Phase1.BeaconState,
  shardTransitions: Phase1.ShardTransition[]
): boolean {
  const activeShardCount = getActiveShardCount(config, state);
  const previousSlot = computePreviousSlot(state.slot);
  for (let shard = 0; shard < activeShardCount; shard++) {
    if (state.shardStates[shard].slot !== previousSlot) {
      if (
        !config.types.phase1.ShardTransition.equals(
          shardTransitions[shard],
          config.types.phase1.ShardTransition.defaultValue()
        )
      ) {
        return false;
      }
    }
  }
  return true;
}
