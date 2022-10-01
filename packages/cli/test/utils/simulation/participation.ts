import {IChainForkConfig} from "@lodestar/config";
import {ForkSeq} from "@lodestar/params";
import {allForks, altair, Epoch} from "@lodestar/types";
import {computeEpochAtSlot, isActiveValidator} from "@lodestar/state-transition";
import {TIMELY_HEAD_FLAG_INDEX, TIMELY_TARGET_FLAG_INDEX, TIMELY_SOURCE_FLAG_INDEX} from "@lodestar/params";

const TIMELY_HEAD = 1 << TIMELY_HEAD_FLAG_INDEX;
const TIMELY_SOURCE = 1 << TIMELY_SOURCE_FLAG_INDEX;
const TIMELY_TARGET = 1 << TIMELY_TARGET_FLAG_INDEX;

/**
 * Returns the count of shuffledParticipants in all attestations of a block
 */
export function getBlockAttestationParticipantCount(block: allForks.BeaconBlock): number {
  // Use a Set since the same validator can be included in multiple attestations
  const shuffledParticipants = new Set<number>();

  for (const attestation of block.body.attestations) {
    // Assume constant committee size on all committees
    const committeeSize = attestation.aggregationBits.bitLen;
    const indexesInCommittee = attestation.aggregationBits.getTrueBitIndexes();
    for (const indexInCommittee of indexesInCommittee) {
      const shuffledIndex = indexInCommittee + attestation.data.index * committeeSize;
      shuffledParticipants.add(shuffledIndex);
    }
  }

  return shuffledParticipants.size;
}

/**
 * Return inclusion score computed as `Sum(block.slot - attestation.data.slot - 1)`
 */
export function getBlockAttestationInclusionScore(block: allForks.BeaconBlock): number {
  let inclusionScore = 0;

  for (const attestation of block.body.attestations) {
    inclusionScore += block.slot - attestation.data.slot - 1;
  }

  return inclusionScore;
}

/**
 * Returns the participation fraction in the syncAggregate of a post-altair block
 */
export function getBlockSyncCommitteeParticipation(
  config: IChainForkConfig,
  block: allForks.BeaconBlock
): number | null {
  if (config.getForkSeq(block.slot) < ForkSeq.altair) {
    return null;
  }

  const {syncCommitteeBits} = (block as altair.BeaconBlock).body.syncAggregate;
  return syncCommitteeBits.getTrueBitIndexes().length / syncCommitteeBits.bitLen;
}

export type EpochParticipationAvg = {source: number; target: number; head: number};

export function computeAltairEpochParticipation(state: altair.BeaconState, epoch: Epoch): EpochParticipationAvg {
  const stateEpoch = computeEpochAtSlot(state.slot);
  let epochParticipation: number[];
  if (stateEpoch === epoch) {
    epochParticipation = state.currentEpochParticipation;
  } else if (stateEpoch === epoch + 1) {
    epochParticipation = state.previousEpochParticipation;
  } else {
    throw Error(`Can not compute participation for epoch ${epoch} with state at slot ${state.slot}`);
  }

  const totalAttestingBalance = {source: 0, target: 0, head: 0};
  let totalActiveEffectiveBalance = 0;

  for (let i = 0; i < epochParticipation.length; i++) {
    const {effectiveBalance} = state.validators[i];
    const flags = epochParticipation[i];
    if ((flags & TIMELY_SOURCE) === TIMELY_SOURCE) totalAttestingBalance.source += effectiveBalance;
    if ((flags & TIMELY_TARGET) === TIMELY_TARGET) totalAttestingBalance.target += effectiveBalance;
    if ((flags & TIMELY_HEAD) === TIMELY_HEAD) totalAttestingBalance.head += effectiveBalance;

    if (isActiveValidator(state.validators[i], epoch)) {
      totalActiveEffectiveBalance += effectiveBalance;
    }
  }

  totalAttestingBalance.head = totalAttestingBalance.head / totalActiveEffectiveBalance;
  totalAttestingBalance.source = totalAttestingBalance.source / totalActiveEffectiveBalance;
  totalAttestingBalance.target = totalAttestingBalance.target / totalActiveEffectiveBalance;

  return totalAttestingBalance;
}
