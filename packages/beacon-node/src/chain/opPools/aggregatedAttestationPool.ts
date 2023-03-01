import bls from "@chainsafe/bls";
import {
  ForkName,
  MAX_ATTESTATIONS,
  MIN_ATTESTATION_INCLUSION_DELAY,
  SLOTS_PER_EPOCH,
  TIMELY_SOURCE_FLAG_INDEX,
} from "@lodestar/params";
import {phase0, Epoch, Slot, ssz, ValidatorIndex} from "@lodestar/types";
import {
  CachedBeaconStateAllForks,
  CachedBeaconStatePhase0,
  CachedBeaconStateAltair,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  getBlockRootAtSlot,
} from "@lodestar/state-transition";
import {toHexString} from "@chainsafe/ssz";
import {IForkChoice, EpochDifference} from "@lodestar/fork-choice";
import {toHex, MapDef} from "@lodestar/utils";
import {intersectUint8Arrays, IntersectResult} from "../../util/bitArray.js";
import {pruneBySlot, signatureFromBytesNoCheck} from "./utils.js";
import {InsertOutcome} from "./types.js";

type DataRootHex = string;

type AttestationWithScore = {attestation: phase0.Attestation; score: number};

type GetParticipationFn = (epoch: Epoch, committee: number[]) => Set<number> | null;

/**
 * Limit the max attestations with the same AttestationData.
 * Processing cost increases with each new attestation. This number is not backed by data.
 * After merging AggregatedAttestationPool, gather numbers from a real network and investigate
 * how does participation looks like in attestations.
 */
const MAX_RETAINED_ATTESTATIONS_PER_GROUP = 4;

/**
 * On mainnet, each slot has 64 committees, and each block has 128 attestations max so we don't
 * want to store more than 2 per group.
 */
const MAX_ATTESTATIONS_PER_GROUP = 2;

/** Same to https://github.com/ethereum/eth2.0-specs/blob/v1.1.0-alpha.5/specs/altair/beacon-chain.md#has_flag */
const TIMELY_SOURCE = 1 << TIMELY_SOURCE_FLAG_INDEX;

/**
 * Maintain a pool of aggregated attestations. Attestations can be retrieved for inclusion in a block
 * or api. The returned attestations are aggregated to maximise the number of validators that can be
 * included.
 * Note that we want to remove attestations with attesters that were included in the chain.
 */
export class AggregatedAttestationPool {
  private readonly attestationGroupByDataHashBySlot = new MapDef<Slot, Map<DataRootHex, MatchingDataAttestationGroup>>(
    () => new Map<DataRootHex, MatchingDataAttestationGroup>()
  );
  private lowestPermissibleSlot = 0;

  /** For metrics to track size of the pool */
  getAttestationCount(): {attestationCount: number; attestationDataCount: number} {
    let attestationCount = 0;
    let attestationDataCount = 0;
    for (const attestationGroupByData of this.attestationGroupByDataHashBySlot.values()) {
      attestationDataCount += attestationGroupByData.size;
      for (const attestationGroup of attestationGroupByData.values()) {
        attestationCount += attestationGroup.getAttestationCount();
      }
    }
    return {attestationCount, attestationDataCount};
  }

  add(attestation: phase0.Attestation, attestingIndicesCount: number, committee: ValidatorIndex[]): InsertOutcome {
    const slot = attestation.data.slot;
    const lowestPermissibleSlot = this.lowestPermissibleSlot;

    // Reject any attestations that are too old.
    if (slot < lowestPermissibleSlot) {
      return InsertOutcome.Old;
    }

    const attestationGroupByDataHash = this.attestationGroupByDataHashBySlot.getOrDefault(slot);
    const dataRoot = ssz.phase0.AttestationData.hashTreeRoot(attestation.data);
    const dataRootHex = toHexString(dataRoot);

    let attestationGroup = attestationGroupByDataHash.get(dataRootHex);
    if (!attestationGroup) {
      attestationGroup = new MatchingDataAttestationGroup(committee, attestation.data);
      attestationGroupByDataHash.set(dataRootHex, attestationGroup);
    }

    return attestationGroup.add({
      attestation,
      trueBitsCount: attestingIndicesCount,
    });
  }

  /** Remove attestations which are too old to be included in a block. */
  prune(clockSlot: Slot): void {
    // Only retain SLOTS_PER_EPOCH slots
    pruneBySlot(this.attestationGroupByDataHashBySlot, clockSlot, SLOTS_PER_EPOCH);
    this.lowestPermissibleSlot = Math.max(clockSlot - SLOTS_PER_EPOCH, 0);
  }

  /**
   * Get attestations to be included in a block. Returns $MAX_ATTESTATIONS items
   */
  getAttestationsForBlock(forkChoice: IForkChoice, state: CachedBeaconStateAllForks): phase0.Attestation[] {
    const stateSlot = state.slot;
    const stateEpoch = state.epochCtx.epoch;
    const statePrevEpoch = stateEpoch - 1;

    const getParticipation = getParticipationFn(state);

    const attestationsByScore: AttestationWithScore[] = [];

    const slots = Array.from(this.attestationGroupByDataHashBySlot.keys()).sort((a, b) => b - a);
    slot: for (const slot of slots) {
      const attestationGroupByDataHash = this.attestationGroupByDataHashBySlot.get(slot);
      // should not happen
      if (!attestationGroupByDataHash) {
        throw Error(`No aggregated attestation pool for slot=${slot}`);
      }

      const epoch = computeEpochAtSlot(slot);
      // validateAttestation condition: Attestation target epoch not in previous or current epoch
      if (!(epoch === stateEpoch || epoch === statePrevEpoch)) {
        continue; // Invalid attestations
      }
      // validateAttestation condition: Attestation slot not within inclusion window
      if (!(slot + MIN_ATTESTATION_INCLUSION_DELAY <= stateSlot && stateSlot <= slot + SLOTS_PER_EPOCH)) {
        continue; // Invalid attestations
      }

      const attestationGroups = Array.from(attestationGroupByDataHash.values());
      for (const attestationGroup of attestationGroups) {
        if (!isValidAttestationData(forkChoice, state, attestationGroup.data)) {
          continue;
        }
        const participation = getParticipation(epoch, attestationGroup.committee);
        if (participation === null) {
          continue;
        }

        // TODO: Is it necessary to validateAttestation for:
        // - Attestation committee index not within current committee count
        // - Attestation aggregation bits length does not match committee length
        //
        // These properties should not change after being validate in gossip
        // IF they have to be validated, do it only with one attestation per group since same data
        // The committeeCountPerSlot can be precomputed once per slot

        attestationsByScore.push(
          ...attestationGroup.getAttestationsForBlock(participation).map((attestation) => ({
            attestation: attestation.attestation,
            score: attestation.notSeenAttesterCount / (stateSlot - slot),
          }))
        );

        // Stop accumulating attestations there are enough that may have good scoring
        if (attestationsByScore.length > MAX_ATTESTATIONS * 2) {
          break slot;
        }
      }
    }

    return attestationsByScore
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_ATTESTATIONS)
      .map((attestation) => attestation.attestation);
  }

  /**
   * Get all attestations optionally filtered by `attestation.data.slot`
   * @param bySlot slot to filter, `bySlot === attestation.data.slot`
   */
  getAll(bySlot?: Slot): phase0.Attestation[] {
    let attestationGroupsArr: Map<string, MatchingDataAttestationGroup>[];
    if (bySlot === undefined) {
      attestationGroupsArr = Array.from(this.attestationGroupByDataHashBySlot.values());
    } else {
      const attestationGroups = this.attestationGroupByDataHashBySlot.get(bySlot);
      if (!attestationGroups) throw Error(`No attestations for slot ${bySlot}`);
      attestationGroupsArr = [attestationGroups];
    }

    const attestations: phase0.Attestation[] = [];
    for (const attestationGroups of attestationGroupsArr) {
      for (const attestationGroup of attestationGroups.values()) {
        attestations.push(...attestationGroup.getAttestations());
      }
    }
    return attestations;
  }
}

interface AttestationWithIndex {
  attestation: phase0.Attestation;
  trueBitsCount: number;
}

type AttestationNonParticipant = {
  attestation: phase0.Attestation;
  // this is <= attestingIndices.count since some attesters may be seen by the chain
  // this is only updated and used in removeBySeenValidators function
  notSeenAttesterCount: number;
};

/**
 * Maintain a pool of AggregatedAttestation which all share the same AttestationData.
 * Preaggregate into smallest number of attestations.
 * When getting attestations to be included in a block, sort by number of attesters.
 * Use committee instead of aggregationBits to improve performance.
 */
export class MatchingDataAttestationGroup {
  private readonly attestations: AttestationWithIndex[] = [];

  constructor(readonly committee: ValidatorIndex[], readonly data: phase0.AttestationData) {}

  getAttestationCount(): number {
    return this.attestations.length;
  }

  /**
   * Add an attestation.
   * Try to preaggregate to existing attestations if possible.
   * If it's a subset of an existing attestations, it's not neccesrary to add to our pool.
   * If it's a superset of an existing attestation, remove the existing attestation and add new.
   */
  add(attestation: AttestationWithIndex): InsertOutcome {
    const newBits = attestation.attestation.aggregationBits;

    const indicesToRemove = [];

    for (const [i, prevAttestation] of this.attestations.entries()) {
      const prevBits = prevAttestation.attestation.aggregationBits;

      switch (intersectUint8Arrays(newBits.uint8Array, prevBits.uint8Array)) {
        case IntersectResult.Subset:
        case IntersectResult.Equal:
          // this new attestation is actually a subset of an existing one, don't want to add it
          return InsertOutcome.AlreadyKnown;

        case IntersectResult.Exclusive:
          // no intersection
          aggregateInto(prevAttestation, attestation);
          return InsertOutcome.Aggregated;

        case IntersectResult.Superset:
          // newBits superset of prevBits
          // this new attestation is superset of an existing one, remove existing one
          indicesToRemove.push(i);
      }
    }

    // Added new data
    for (const index of indicesToRemove.reverse()) {
      // TODO: .splice performance warning
      this.attestations.splice(index, 1);
    }

    this.attestations.push(attestation);

    // Remove the attestations with less participation
    if (this.attestations.length > MAX_RETAINED_ATTESTATIONS_PER_GROUP) {
      this.attestations.sort((a, b) => b.trueBitsCount - a.trueBitsCount);
      this.attestations.splice(
        MAX_RETAINED_ATTESTATIONS_PER_GROUP,
        this.attestations.length - MAX_RETAINED_ATTESTATIONS_PER_GROUP
      );
    }

    return InsertOutcome.NewData;
  }

  getAttestationsForBlock(seenAttestingIndices: Set<ValidatorIndex>): AttestationNonParticipant[] {
    const attestations: AttestationNonParticipant[] = [];

    const committeeLen = this.committee.length;
    const committeeSeenAttesting = new Array<boolean>(committeeLen);

    // Intersect committee with participation only once for all attestations
    for (let i = 0; i < committeeLen; i++) {
      committeeSeenAttesting[i] = seenAttestingIndices.has(this.committee[i]);
    }

    for (const {attestation} of this.attestations) {
      const {aggregationBits} = attestation;
      let notSeenAttesterCount = 0;

      for (let i = 0; i < committeeLen; i++) {
        // TODO: Optimize aggregationBits.get() in bulk for the entire BitArray
        if (!committeeSeenAttesting[i] && aggregationBits.get(i)) {
          notSeenAttesterCount++;
        }
      }

      if (notSeenAttesterCount > 0) {
        attestations.push({attestation, notSeenAttesterCount});
      }
    }

    return attestations
      .sort((a, b) => b.notSeenAttesterCount - a.notSeenAttesterCount)
      .slice(0, MAX_ATTESTATIONS_PER_GROUP);
  }

  /** Get attestations for API. */
  getAttestations(): phase0.Attestation[] {
    return this.attestations.map((attestation) => attestation.attestation);
  }
}

export function aggregateInto(attestation1: AttestationWithIndex, attestation2: AttestationWithIndex): void {
  // Merge bits of attestation2 into attestation1
  attestation1.attestation.aggregationBits.mergeOrWith(attestation2.attestation.aggregationBits);

  const signature1 = signatureFromBytesNoCheck(attestation1.attestation.signature);
  const signature2 = signatureFromBytesNoCheck(attestation2.attestation.signature);
  attestation1.attestation.signature = bls.Signature.aggregate([signature1, signature2]).toBytes();
}

/**
 * Pre-compute participation from a CachedBeaconStateAllForks, for use to check if an attestation's committee
 * has already attested or not.
 */
export function getParticipationFn(state: CachedBeaconStateAllForks): GetParticipationFn {
  if (state.config.getForkName(state.slot) === ForkName.phase0) {
    // Get attestations to be included in a phase0 block.
    // As we are close to altair, this is not really important, it's mainly for e2e.
    // The performance is not great due to the different BeaconState data structure to altair.
    // check for phase0 block already
    const phase0State = state as CachedBeaconStatePhase0;
    const stateEpoch = computeEpochAtSlot(state.slot);

    const previousEpochParticipants = extractParticipation(
      phase0State.previousEpochAttestations.getAllReadonly(),
      state
    );
    const currentEpochParticipants = extractParticipation(phase0State.currentEpochAttestations.getAllReadonly(), state);

    return (epoch: Epoch) => {
      return epoch === stateEpoch
        ? currentEpochParticipants
        : epoch === stateEpoch - 1
        ? previousEpochParticipants
        : null;
    };
  }

  // altair and future forks
  else {
    // Get attestations to be included in an altair block.
    // Attestations are sorted by inclusion distance then number of attesters.
    // Attestations should pass the validation when processing attestations in state-transition.
    // check for altair block already
    const altairState = state as CachedBeaconStateAltair;
    const previousParticipation = altairState.previousEpochParticipation.getAll();
    const currentParticipation = altairState.currentEpochParticipation.getAll();
    const stateEpoch = computeEpochAtSlot(state.slot);

    return (epoch: Epoch, committee: number[]) => {
      const participationStatus =
        epoch === stateEpoch ? currentParticipation : epoch === stateEpoch - 1 ? previousParticipation : null;

      if (participationStatus === null) return null;

      const seenValidatorIndices = new Set<ValidatorIndex>();
      for (const validatorIndex of committee) {
        if (flagIsTimelySource(participationStatus[validatorIndex])) {
          seenValidatorIndices.add(validatorIndex);
        }
      }
      return seenValidatorIndices;
    };
  }
}

export function extractParticipation(
  attestations: phase0.PendingAttestation[],
  state: CachedBeaconStateAllForks
): Set<ValidatorIndex> {
  const {epochCtx} = state;
  const allParticipants = new Set<ValidatorIndex>();
  for (const att of attestations) {
    const aggregationBits = att.aggregationBits;
    const attData = att.data;
    const attSlot = attData.slot;
    const committeeIndex = attData.index;
    const committee = epochCtx.getBeaconCommittee(attSlot, committeeIndex);
    const participants = aggregationBits.intersectValues(committee);
    for (const participant of participants) {
      allParticipants.add(participant);
    }
  }
  return allParticipants;
}

/**
 * Do those validations:
 *   - Validate the source checkpoint
 *   - Since we validated attestation's signature in gossip validation function,
 *     we only need to validate the shuffling of attestation
 *     is compatible to this state.
 *     (see https://github.com/ChainSafe/lodestar/issues/4333)
 * @returns
 */
export function isValidAttestationData(
  forkChoice: IForkChoice,
  state: CachedBeaconStateAllForks,
  data: phase0.AttestationData
): boolean {
  const {previousJustifiedCheckpoint, currentJustifiedCheckpoint} = state;
  let justifiedCheckpoint;
  const stateEpoch = state.epochCtx.epoch;
  const targetEpoch = data.target.epoch;

  if (targetEpoch === stateEpoch) {
    justifiedCheckpoint = currentJustifiedCheckpoint;
  } else if (targetEpoch === stateEpoch - 1) {
    justifiedCheckpoint = previousJustifiedCheckpoint;
  } else {
    return false;
  }

  if (!ssz.phase0.Checkpoint.equals(data.source, justifiedCheckpoint)) return false;

  // Shuffling can't have changed if we're in the first few epochs
  // Also we can't look back 2 epochs if target epoch is 1 or less
  if (stateEpoch < 2 || targetEpoch < 2) {
    return true;
  }
  // Otherwise the shuffling is determined by the block at the end of the target epoch
  // minus the shuffling lookahead (usually 2). We call this the "pivot".
  const pivotSlot = computeStartSlotAtEpoch(targetEpoch - 1) - 1;
  const stateDependentRoot = toHexString(getBlockRootAtSlot(state, pivotSlot));

  // Use fork choice's view of the block DAG to quickly evaluate whether the attestation's
  // pivot block is the same as the current state's pivot block. If it is, then the
  // attestation's shuffling is the same as the current state's.
  // To account for skipped slots, find the first block at *or before* the pivot slot.
  const beaconBlockRootHex = toHex(data.beaconBlockRoot);
  const beaconBlock = forkChoice.getBlockHex(beaconBlockRootHex);
  if (!beaconBlock) {
    throw Error(`Attestation data.beaconBlockRoot ${beaconBlockRootHex} not found in forkchoice`);
  }

  let attestationDependantRoot: string;
  try {
    attestationDependantRoot = forkChoice.getDependentRoot(beaconBlock, EpochDifference.previous);
  } catch (_) {
    // getDependent root may throw error if the dependent root of attestation data is prior to finalized slot
    // ignore this attestation data in that case since we're not sure it's compatible to the state
    // see https://github.com/ChainSafe/lodestar/issues/4743
    return false;
  }
  return attestationDependantRoot === stateDependentRoot;
}

function flagIsTimelySource(flag: number): boolean {
  return (flag & TIMELY_SOURCE) === TIMELY_SOURCE;
}
