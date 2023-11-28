import {CachedBeaconStateAllForks, CachedBeaconStateAltair, CachedBeaconStatePhase0} from "@lodestar/state-transition";
import {getAttestationParticipationStatus} from "@lodestar/state-transition/src/block/processAttestationsAltair";
import {RootCache} from "@lodestar/state-transition/src/util/rootCache";
import {Gwei, allForks, altair, phase0} from "@lodestar/types";
import {
  PROPOSER_WEIGHT,
  TIMELY_HEAD_FLAG_INDEX,
  TIMELY_HEAD_WEIGHT,
  TIMELY_SOURCE_FLAG_INDEX,
  TIMELY_SOURCE_WEIGHT,
  TIMELY_TARGET_FLAG_INDEX,
  TIMELY_TARGET_WEIGHT,
  WEIGHT_DENOMINATOR,
  ForkName,
} from "@lodestar/params";

const PROPOSER_REWARD_DOMINATOR = ((WEIGHT_DENOMINATOR - PROPOSER_WEIGHT) * WEIGHT_DENOMINATOR) / PROPOSER_WEIGHT;

/** Same to https://github.com/ethereum/eth2.0-specs/blob/v1.1.0-alpha.5/specs/altair/beacon-chain.md#has_flag */
const TIMELY_SOURCE = 1 << TIMELY_SOURCE_FLAG_INDEX;
const TIMELY_TARGET = 1 << TIMELY_TARGET_FLAG_INDEX;
const TIMELY_HEAD = 1 << TIMELY_HEAD_FLAG_INDEX;

/**
 * Calculate total proposer block rewards given block and state
 * Standard (Non MEV) rewards for proposing a block consists of:
 *  1) Including attestations from (beacon) committee
 *  2) Including attestations from sync committee
 *  3) Reporting slashable behaviours from proposer and attester
 * TODO: Return the breakdown of the rewards and other metadata to comply with the beacon rewards endpoint
 */
export async function computeBlockRewards(
  block: allForks.BeaconBlock,
  state: CachedBeaconStateAllForks
): Promise<Gwei> {
  if (block.slot !== state.slot) {
    throw Error(`Block slot and state slot mismatch. Block slot: ${block.slot}, state slot: ${state.slot}`);
  }

  const fork = state.config.getForkName(block.slot);
  const blockAttestationReward =
    fork === ForkName.phase0
      ? computeBlockAttestationRewardPhase0(block as phase0.BeaconBlock, state as CachedBeaconStatePhase0)
      : computeBlockAttestationRewardAltair(block as altair.BeaconBlock, state as CachedBeaconStateAltair);
  const syncAggregateReward = computeSyncAggregateReward();
  const blockProposerSlashingReward = computeBlockProposerSlashingReward();
  const blockAttesterSlashingReward = computeBlockAttesterSlashingReward();

  const total =
    blockAttestationReward + syncAggregateReward + blockProposerSlashingReward + blockAttesterSlashingReward;

  return total;
}

/**
 * Calculate rewards received by block proposer for incuding attestations.
 */
function computeBlockAttestationRewardPhase0(block: phase0.BeaconBlock, state: CachedBeaconStatePhase0): Gwei {
  return 0n; // TODO
}

/**
 * Calculate rewards received by block proposer for incuding attestations. Mimics `processAttestationsAltair()`
 */
function computeBlockAttestationRewardAltair(block: altair.BeaconBlock, state: CachedBeaconStateAltair): Gwei {
  const {epochCtx} = state;
  const {effectiveBalanceIncrements} = epochCtx;
  const stateSlot = state.slot;
  const rootCache = new RootCache(state);
  const currentEpoch = epochCtx.epoch;
  const fork = state.config.getForkSeq(block.slot);

  let blockAttestationReward = 0n;

  for (const attestation of block.body.attestations) {
    const data = attestation.data;

    const committeeIndices = epochCtx.getBeaconCommittee(data.slot, data.index);
    const attestingIndices = attestation.aggregationBits.intersectValues(committeeIndices);

    const inCurrentEpoch = data.target.epoch === currentEpoch;
    const epochParticipation = inCurrentEpoch ? state.currentEpochParticipation : state.previousEpochParticipation;

    const flagsAttestation = getAttestationParticipationStatus(
      fork,
      data,
      stateSlot - data.slot,
      epochCtx.epoch,
      rootCache
    );

    let totalBalanceIncrementsWithWeight = 0;
    for (const index of attestingIndices) {
      const flags = epochParticipation.get(index);
      epochParticipation.set(index, flagsAttestation);
      const flagsNewSet = ~flags & flagsAttestation;

      // Spec:
      // baseReward = state.validators[index].effectiveBalance / EFFECTIVE_BALANCE_INCREMENT * baseRewardPerIncrement;
      // proposerRewardNumerator += baseReward * totalWeight
      let totalWeight = 0;
      if ((flagsNewSet & TIMELY_SOURCE) === TIMELY_SOURCE) totalWeight += TIMELY_SOURCE_WEIGHT;
      if ((flagsNewSet & TIMELY_TARGET) === TIMELY_TARGET) totalWeight += TIMELY_TARGET_WEIGHT;
      if ((flagsNewSet & TIMELY_HEAD) === TIMELY_HEAD) totalWeight += TIMELY_HEAD_WEIGHT;

      if (totalWeight > 0) {
        totalBalanceIncrementsWithWeight += effectiveBalanceIncrements[index] * totalWeight;
      }
    }

    const totalIncrements = totalBalanceIncrementsWithWeight;
    const proposerRewardNumerator = totalIncrements * state.epochCtx.baseRewardPerIncrement;
    blockAttestationReward =
      blockAttestationReward + BigInt(Math.floor(proposerRewardNumerator / PROPOSER_REWARD_DOMINATOR));
  }

  return blockAttestationReward;
}

function computeSyncAggregateReward(): Gwei {
  return 0n; //TODO
}

function computeBlockProposerSlashingReward(): Gwei {
  return 0n; //TODO
}

function computeBlockAttesterSlashingReward(): Gwei {
  return 0n; //TODO
}
