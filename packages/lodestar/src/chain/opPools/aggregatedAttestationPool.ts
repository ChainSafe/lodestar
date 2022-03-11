import bls from "@chainsafe/bls";
import {
  ForkName,
  MAX_ATTESTATIONS,
  MIN_ATTESTATION_INCLUSION_DELAY,
  SLOTS_PER_EPOCH,
  TIMELY_SOURCE_FLAG_INDEX,
} from "@chainsafe/lodestar-params";
import {Epoch, ParticipationFlags, Slot, ssz, ValidatorIndex} from "@chainsafe/lodestar-types";
import {
  CachedBeaconStateAllForks,
  CachedBeaconStatePhase0,
  CachedBeaconStateAltair,
  computeEpochAtSlot,
  phase0,
  zipIndexesCommitteeBits,
} from "@chainsafe/lodestar-beacon-state-transition";
import {BitList, List, readonlyValues, toHexString} from "@chainsafe/ssz";
import {MapDef} from "../../util/map";
import {pruneBySlot} from "./utils";
import {InsertOutcome} from "./types";

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

  add(attestation: phase0.Attestation, attestingIndices: ValidatorIndex[], committee: ValidatorIndex[]): InsertOutcome {
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

    return attestationGroup.add({attestation, attestingIndices: new Set(attestingIndices)});
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
  getAttestationsForBlock(state: CachedBeaconStateAllForks): phase0.Attestation[] {
    const stateSlot = state.slot;
    const stateEpoch = state.currentShuffling.epoch;
    const statePrevEpoch = stateEpoch - 1;
    const forkName = state.config.getForkName(stateSlot);

    const getParticipationFn =
      forkName === ForkName.phase0 ? this.getParticipationPhase0(state) : this.getParticipationAltair(state);

    const attestationsByScore: AttestationWithScore[] = [];

    const slots = Array.from(this.attestationGroupByDataHashBySlot.keys()).sort((a, b) => b - a);
    const {previousJustifiedCheckpoint, currentJustifiedCheckpoint} = state;
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
        if (
          !isValidAttestationData(
            stateEpoch,
            previousJustifiedCheckpoint,
            currentJustifiedCheckpoint,
            attestationGroup.data
          )
        ) {
          continue;
        }
        const participation = getParticipationFn(epoch, attestationGroup.committee);
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
            score: (attestation.notSeenAttesterCount ?? attestation.attestingIndices.size) / (stateSlot - slot),
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

  /**
   * Get attestations to be included in a phase0 block.
   * As we are close to altair, this is not really important, it's mainly for e2e.
   * The performance is not great due to the different BeaconState data structure to altair.
   */
  private getParticipationPhase0(state: CachedBeaconStateAllForks): GetParticipationFn {
    // check for phase0 block already
    const phase0State = state as CachedBeaconStatePhase0;
    const stateEpoch = computeEpochAtSlot(state.slot);

    const previousEpochParticipants = extractParticipation(phase0State.previousEpochAttestations, state);
    const currentEpochParticipants = extractParticipation(phase0State.currentEpochAttestations, state);

    return (epoch: Epoch) => {
      return epoch === stateEpoch
        ? currentEpochParticipants
        : epoch === stateEpoch - 1
        ? previousEpochParticipants
        : null;
    };
  }

  /**
   * Get attestations to be included in an altair block.
   * Attestations are sorted by inclusion distance then number of attesters.
   * Attestations should pass the validation when processing attestations in beacon-state-transition.
   */
  private getParticipationAltair(state: CachedBeaconStateAllForks): GetParticipationFn {
    // check for altair block already
    const altairState = state as CachedBeaconStateAltair;
    const stateEpoch = computeEpochAtSlot(state.slot);
    const previousParticipation = altairState.previousEpochParticipation.persistent.toArray();
    const currentParticipation = altairState.currentEpochParticipation.persistent.toArray();

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

// eslint-disable-next-line @typescript-eslint/naming-convention
interface AttestationWithIndex {
  attestation: phase0.Attestation;
  attestingIndices: Set<ValidatorIndex>;
  // this is <= attestingIndices.count since some attesters may be seen by the chain
  // this is only updated and used in removeBySeenValidators function
  notSeenAttesterCount?: number;
}

/**
 * Maintain a pool of AggregatedAttestation which all share the same AttestationData.
 * Preaggregate into smallest number of attestations.
 * When getting attestations to be included in a block, sort by number of attesters.
 * Use committee instead of aggregationBits to improve performance.
 */
export class MatchingDataAttestationGroup {
  private readonly attestations: AttestationWithIndex[] = [];

  constructor(readonly committee: ValidatorIndex[], readonly data: phase0.AttestationData) {}

  /**
   * Add an attestation.
   * Try to preaggregate to existing attestations if possible.
   * If it's a subset of an existing attestations, it's not neccesrary to add to our pool.
   * If it's a superset of an existing attestation, remove the existing attestation and add new.
   */
  add(attestation: AttestationWithIndex): InsertOutcome {
    const {attestingIndices} = attestation;
    // preaggregate
    let insertResult = InsertOutcome.NewData;
    const indicesToRemove = [];
    for (const [i, existingAttestation] of this.attestations.entries()) {
      const existingAttestingIndices = existingAttestation.attestingIndices;
      const numIntersection =
        existingAttestingIndices.size >= attestingIndices.size
          ? intersection(existingAttestingIndices, attestingIndices)
          : intersection(attestingIndices, existingAttestingIndices);
      // no intersection
      if (numIntersection === 0) {
        aggregateInto(existingAttestation, attestation);
        insertResult = InsertOutcome.Aggregated;
      } else if (numIntersection === attestingIndices.size) {
        // this new attestation is actually a subset of an existing one, don't want to add it
        insertResult = InsertOutcome.AlreadyKnown;
      } else if (numIntersection === existingAttestingIndices.size) {
        // this new attestation is superset of an existing one, remove existing one
        indicesToRemove.push(i);
      }
    }
    if (insertResult === InsertOutcome.NewData) {
      for (const index of indicesToRemove.reverse()) {
        this.attestations.splice(index, 1);
      }
      this.attestations.push(attestation);
      // Remove the attestations with less participation
      if (this.attestations.length > MAX_RETAINED_ATTESTATIONS_PER_GROUP) {
        this.attestations.sort((a, b) => b.attestingIndices.size - a.attestingIndices.size);
        this.attestations.splice(
          MAX_RETAINED_ATTESTATIONS_PER_GROUP,
          this.attestations.length - MAX_RETAINED_ATTESTATIONS_PER_GROUP
        );
      }
    }
    return insertResult;
  }

  getAttestationsForBlock(seenAttestingIndices: Set<ValidatorIndex>): AttestationWithIndex[] {
    const attestations: AttestationWithIndex[] = [];

    for (const attestation of this.attestations) {
      let notSeenAttesterCount = 0;
      for (const attIndex of attestation.attestingIndices) {
        if (!seenAttestingIndices.has(attIndex)) notSeenAttesterCount++;
      }
      if (notSeenAttesterCount > 0) {
        attestations.push({...attestation, notSeenAttesterCount});
      }
    }

    return attestations
      .sort(
        (a, b) =>
          (b.notSeenAttesterCount ?? b.attestingIndices.size) - (a.notSeenAttesterCount ?? a.attestingIndices.size)
      )
      .slice(0, MAX_ATTESTATIONS_PER_GROUP);
  }

  /** Get attestations for API. */
  getAttestations(): phase0.Attestation[] {
    return this.attestations.map((attestation) => attestation.attestation);
  }
}

export function aggregateInto(attestation1: AttestationWithIndex, attestation2: AttestationWithIndex): void {
  for (const attIndex of attestation2.attestingIndices) {
    attestation1.attestingIndices.add(attIndex);
  }

  // Merge bits of attestation2 into attestation1
  bitArrayMergeOrWith(attestation1.attestation.aggregationBits, attestation2.attestation.aggregationBits);

  const signature1 = bls.Signature.fromBytes(
    attestation1.attestation.signature.valueOf() as Uint8Array,
    undefined,
    true
  );
  const signature2 = bls.Signature.fromBytes(
    attestation2.attestation.signature.valueOf() as Uint8Array,
    undefined,
    true
  );
  attestation1.attestation.signature = bls.Signature.aggregate([signature1, signature2]).toBytes();
}

export function extractParticipation(
  attestations: List<phase0.PendingAttestation>,
  state: CachedBeaconStateAllForks
): Set<ValidatorIndex> {
  const {epochCtx} = state;
  const allParticipants = new Set<ValidatorIndex>();
  for (const att of readonlyValues(attestations)) {
    const aggregationBits = att.aggregationBits;
    const attData = att.data;
    const attSlot = attData.slot;
    const committeeIndex = attData.index;
    const committee = epochCtx.getBeaconCommittee(attSlot, committeeIndex);
    const participants = zipIndexesCommitteeBits(committee, aggregationBits);
    for (const participant of participants) {
      allParticipants.add(participant);
    }
  }
  return allParticipants;
}

export function intersection(bigSet: Set<ValidatorIndex>, smallSet: Set<ValidatorIndex>): number {
  let numIntersection = 0;
  for (const validatorIndex of smallSet) {
    if (bigSet.has(validatorIndex)) numIntersection++;
  }
  return numIntersection;
}

/**
 * The state transition accepts incorrect target and head attestations.
 * We only need to validate the source checkpoint.
 * @returns
 */
export function isValidAttestationData(
  currentEpoch: Epoch,
  previousJustifiedCheckpoint: phase0.Checkpoint,
  currentJustifiedCheckpoint: phase0.Checkpoint,
  data: phase0.AttestationData
): boolean {
  let justifiedCheckpoint;
  if (data.target.epoch === currentEpoch) {
    justifiedCheckpoint = currentJustifiedCheckpoint;
  } else {
    justifiedCheckpoint = previousJustifiedCheckpoint;
  }
  return ssz.phase0.Checkpoint.equals(data.source, justifiedCheckpoint);
}

/**
 * Returns true if the `TIMELY_SOURCE` bit in a `ParticipationFlags` is set
 */
export function flagIsTimelySource(flag: ParticipationFlags): boolean {
  return (flag & TIMELY_SOURCE) === TIMELY_SOURCE;
}

function bitArrayMergeOrWith(bits1: BitList, bits2: BitList): void {
  for (let i = 0; i < bits2.length; i++) {
    if (bits2[i]) {
      bits1[i] = true;
    }
  }
}
