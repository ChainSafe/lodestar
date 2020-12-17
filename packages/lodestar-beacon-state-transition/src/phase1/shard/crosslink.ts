import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {CommitteeIndex, Phase1, Root, ValidatorIndex} from "@chainsafe/lodestar-types";
import {assert} from "@chainsafe/lodestar-utils";
import {getBaseReward} from "../../epoch/balanceUpdates/util";
import {
  getAttestingIndices,
  getBeaconCommittee,
  getBeaconProposerIndex,
  getTotalBalance,
  computeEpochAtSlot,
} from "../../util";
import {decreaseBalance, increaseBalance} from "../../util/balance";
import {computePreviousSlot, computeShardFromCommitteeIndex} from "../misc";
import {getOffsetSlots, getOnlineValidatorIndices, getShardProposerIndex} from "../state";
import {applyShardTransition} from "./transition";
import {getCommitteeCountPerSlot} from "../state/accessors";
import {isOnTimeAttestation, isWinningAttestation} from "../state/predicates";
import {ZERO_HASH} from "../..";

export function processCrosslinkForShard(
  config: IBeaconConfig,
  state: Phase1.BeaconState,
  committeeIndex: CommitteeIndex,
  shardTransition: Phase1.ShardTransition,
  attestations: Phase1.Attestation[]
): Root {
  const onTimeAttestationSlot = computePreviousSlot(state.slot);
  const committee = getBeaconCommittee(config, state, onTimeAttestationSlot, committeeIndex);
  const onlineIndices = getOnlineValidatorIndices(config, state);
  const shard = computeShardFromCommitteeIndex(config, state, committeeIndex, onTimeAttestationSlot);
  const shardTransitionRoots = Array.from(new Set(attestations.map((a) => a.data.shardTransitionRoot))).sort((a, b) =>
    Buffer.compare(a.valueOf() as Uint8Array, b.valueOf() as Uint8Array)
  );
  for (const shardTransitionRoot of shardTransitionRoots) {
    const transitionAttestation = attestations.filter((a) =>
      config.types.Root.equals(a.data.shardTransitionRoot, shardTransitionRoot)
    );
    const transitionParticipants = new Set<ValidatorIndex>();
    for (const attestation of transitionAttestation) {
      const participants = getAttestingIndices(config, state, attestation.data, attestation.aggregationBits);
      participants.forEach((p) => transitionParticipants.add(p));
    }
    const enoughOnlineStake =
      getTotalBalance(
        config,
        state,
        Array.from(onlineIndices).filter((index) => transitionParticipants.has(index))
      ) *
        BigInt(3) >=
      getTotalBalance(
        config,
        state,
        Array.from(onlineIndices).filter((index) => committee.includes(index))
      ) *
        BigInt(2);
    if (!enoughOnlineStake) {
      continue;
    }
    assert.true(
      config.types.Root.equals(shardTransitionRoot, config.types.phase1.ShardTransition.hashTreeRoot(shardTransition))
    );

    const lastOffsetIndex = shardTransition.shardStates.length - 1;
    const shardHeadRoot = shardTransition.shardStates[lastOffsetIndex].latestBlockRoot;
    for (const attestation of transitionAttestation) {
      assert.true(config.types.Root.equals(attestation.data.shardHeadRoot, shardHeadRoot));
    }
    applyShardTransition(config, state, shard, shardTransition);
    const beaconProposerIndex = getBeaconProposerIndex(config, state);
    const estimatedAttesterReward = Array.from(transitionParticipants).reduce((acc, attester) => {
      return acc + getBaseReward(config, state, attester);
    }, BigInt(0));
    const proposerReward = estimatedAttesterReward / BigInt(config.params.PROPOSER_REWARD_QUOTIENT);
    increaseBalance(state, beaconProposerIndex, proposerReward);

    const shardOffsetSlots = getOffsetSlots(config, state, shard);
    for (let i = 0; i < shardTransition.shardBlockLengths.length; i++) {
      const shardState = shardTransition.shardStates[i];
      const shardOffseSlot = shardOffsetSlots[i];
      const length = shardTransition.shardBlockLengths[i];
      const proposerIndex = getShardProposerIndex(config, state, shardOffseSlot, shard);
      decreaseBalance(state, proposerIndex, shardState.gasprice * length);
    }
    return shardTransitionRoot;
  }
  assert.true(
    config.types.phase1.ShardTransition.equals(shardTransition, config.types.phase1.ShardTransition.defaultValue())
  );
  return ZERO_HASH;
}

export function processCrosslink(
  config: IBeaconConfig,
  state: Phase1.BeaconState,
  shardTransitions: Phase1.ShardTransition[],
  attestations: Phase1.Attestation[]
): void {
  const onTimeAttestationSlot = computePreviousSlot(state.slot);
  const committeeCount = getCommitteeCountPerSlot(config, state, computeEpochAtSlot(config, onTimeAttestationSlot));
  for (let committeeIndex = 0; committeeIndex < committeeCount; committeeIndex++) {
    const shard = computeShardFromCommitteeIndex(config, state, committeeIndex, onTimeAttestationSlot);
    const shardAttestations = attestations.filter((a) => isOnTimeAttestation(state, a.data));
    const winningRoot = processCrosslinkForShard(
      config,
      state,
      committeeIndex,
      shardTransitions[shard],
      shardAttestations
    );
    if (!config.types.Root.equals(winningRoot, ZERO_HASH)) {
      state.currentEpochAttestations.forEach((attestation) => {
        if (isWinningAttestation(config, state, attestation, committeeIndex, winningRoot)) {
          attestation.crosslinkSuccess = true;
        }
      });
    }
  }
}
