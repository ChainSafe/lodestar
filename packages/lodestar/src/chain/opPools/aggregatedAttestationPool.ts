import bls from "@chainsafe/bls";
import {ForkName, MAX_ATTESTATIONS, MIN_ATTESTATION_INCLUSION_DELAY, SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {allForks, altair, Epoch, Slot, ssz, ValidatorIndex} from "@chainsafe/lodestar-types";
import {
  CachedBeaconState,
  computeEpochAtSlot,
  phase0,
  zipIndexesCommitteeBits,
} from "@chainsafe/lodestar-beacon-state-transition";
import {List, readonlyValues, toHexString} from "@chainsafe/ssz";
import {MapDef} from "../../util/map";
import {pruneBySlot} from "./utils";
import {InsertOutcome} from "./types";
import {EpochContext} from "../../../../beacon-state-transition/lib/allForks";

type DataRootHex = string;

type AttestationWithScore = {attestation: phase0.Attestation; score: number};

type GetParticipationFn = (epoch: Epoch, committee: number[]) => Set<number> | null;

/**
 * Limit the max attestations with the same AttestationData.
 * Processing cost increases with each new attestation. This number is not backed by data.
 * After merging AggregatedAttestationPool, gather numbers from a real network and investigate
 * how does participation looks like in attestations.
 */
const MAX_ATTESTATIONS_PER_GROUP = 4;

/**
 * Maintain a pool of aggregated attestations. Attestations can be retrieved for inclusion in a block
 * or api. The returned attestations are aggregated to maximise the number of validators that can be
 * included.
 * Note that we want to remove attestations with attesters that were included in the chain.
 */
export class AggregatedAttestationPool {
  private readonly attestationGroupByDataHashBySlot = new MapDef<
    phase0.Slot,
    Map<DataRootHex, MatchingDataAttestationGroup>
  >(() => new Map<DataRootHex, MatchingDataAttestationGroup>());
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
      attestationGroup = new MatchingDataAttestationGroup(committee);
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
   * Get attestations to be included in a block.
   */
  getAttestationsForBlock(state: CachedBeaconState<allForks.BeaconState>): phase0.Attestation[] {
    const stateSlot = state.slot;
    const stateEpoch = computeEpochAtSlot(stateSlot);
    const statePrevEpoch = stateEpoch - 1;
    const forkName = state.config.getForkName(stateSlot);

    const getParticipationFn =
      forkName === ForkName.phase0 ? this.getParticipationPhase0(state) : this.getParticipationAltair(state);

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
  private getParticipationPhase0(state: CachedBeaconState<allForks.BeaconState>): GetParticipationFn {
    // check for phase0 block already
    const phase0State = state as CachedBeaconState<phase0.BeaconState>;
    const {epochCtx} = phase0State;
    const stateEpoch = computeEpochAtSlot(state.slot);

    const previousEpochParticipants = extractParticipation(phase0State.previousEpochAttestations, epochCtx);
    const currentEpochParticipants = extractParticipation(phase0State.currentEpochAttestations, epochCtx);

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
  private getParticipationAltair(state: CachedBeaconState<allForks.BeaconState>): GetParticipationFn {
    // check for altair block already
    const altairState = state as CachedBeaconState<altair.BeaconState>;
    const stateEpoch = computeEpochAtSlot(state.slot);
    const previousParticipation = altairState.previousEpochParticipation.persistent.toArray();
    const currentParticipation = altairState.currentEpochParticipation.persistent.toArray();

    return (epoch: Epoch, committee: number[]) => {
      const participationStatus =
        epoch === stateEpoch ? currentParticipation : epoch === stateEpoch - 1 ? previousParticipation : null;

      if (participationStatus === null) return null;

      const seenValidatorIndices = new Set<ValidatorIndex>();
      for (const validatorIndex of committee) {
        if (participationStatus[validatorIndex]?.timelySource) {
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

  constructor(readonly committee: ValidatorIndex[]) {}

  /** Add an attestation.
   * Try to preaggregate to existing attestations if possible.
   * If it's a subset of an existing attestations, it's not neccesrary to add to our pool.
   */
  add(attestation: AttestationWithIndex): InsertOutcome {
    const {attestingIndices} = attestation;
    // preaggregate
    let insertResult = InsertOutcome.NewData;
    for (const existingAttestation of this.attestations) {
      const existingAttestingIndices = existingAttestation.attestingIndices;
      let numIntersection = 0;
      for (const index of attestingIndices) {
        if (existingAttestingIndices.has(index)) numIntersection++;
      }
      // no intersection
      if (numIntersection === 0) {
        aggregateInto(existingAttestation, attestation, this.committee);
        insertResult = InsertOutcome.Aggregated;
      } else if (numIntersection === attestingIndices.size) {
        // this new attestation is actually a subset of an existing one, don't want to add it
        insertResult = InsertOutcome.AlreadyKnown;
      }
    }
    if (insertResult === InsertOutcome.NewData) {
      this.attestations.push(attestation);

      // Remove the attestations with less participation
      if (this.attestations.length > MAX_ATTESTATIONS_PER_GROUP) {
        this.attestations.sort((a, b) => b.attestingIndices.size - a.attestingIndices.size);
        this.attestations.splice(MAX_ATTESTATIONS_PER_GROUP, this.attestations.length - MAX_ATTESTATIONS_PER_GROUP);
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

    return attestations;
  }

  /** Get attestations for API. */
  getAttestations(): phase0.Attestation[] {
    return this.attestations.map((attestation) => attestation.attestation);
  }
}

export function aggregateInto(
  attestation1: AttestationWithIndex,
  attestation2: AttestationWithIndex,
  committee: ValidatorIndex[]
): void {
  for (const attIndex of attestation2.attestingIndices) {
    attestation1.attestingIndices.add(attIndex);
  }

  attestation1.attestation.aggregationBits = Array.from({length: committee.length}, (_, i) =>
    attestation1.attestingIndices.has(committee[i])
  ) as List<boolean>;

  const signature1 = bls.Signature.fromBytes(attestation1.attestation.signature.valueOf() as Uint8Array);
  const signature2 = bls.Signature.fromBytes(attestation2.attestation.signature.valueOf() as Uint8Array);
  attestation1.attestation.signature = bls.Signature.aggregate([signature1, signature2]).toBytes();
}

export function extractParticipation(
  attestations: List<phase0.PendingAttestation>,
  epochCtx: EpochContext
): Set<ValidatorIndex> {
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
