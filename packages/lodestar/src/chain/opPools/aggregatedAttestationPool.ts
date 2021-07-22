import bls from "@chainsafe/bls";
import {ForkName, MAX_ATTESTATIONS, SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {allForks, altair, Slot, ssz, ValidatorIndex} from "@chainsafe/lodestar-types";
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
  getAttestationsForBlock(
    state: CachedBeaconState<allForks.BeaconState>,
    validateAttestations = false
  ): phase0.Attestation[] {
    const forkName = state.config.getForkName(state.slot);

    const attestations =
      forkName === ForkName.phase0
        ? this.getAttestationsForPhase0Block(state)
        : this.getAttestationsForAltairBlock(state);

    return validateAttestations
      ? attestations.slice(0, MAX_ATTESTATIONS)
      : attestations.filter((attestation) => safeValidateAttestation(state, attestation)).slice(0, MAX_ATTESTATIONS);
  }

  /**
   * Get all attestations optionally filtered by `attestation.data.slot`
   * @param bySlot slot to filter, `bySlot === attestation.data.slot`
   */
  getAll(state: CachedBeaconState<allForks.BeaconState>, bySlot?: Slot): phase0.Attestation[] {
    // we don't want to validate attestations
    let attestations = this.getAttestationsForBlock(state, true);
    if (bySlot) {
      attestations = attestations.filter((att) => att.data.slot === bySlot);
    }
    return attestations;
  }

  /**
   * Get attestations to be included in a phase0 block.
   * As we are close to altair, this is not really important, it's mainly for e2e.
   * The performance is not great due to the different BeaconState data structure to altair.
   */
  private getAttestationsForPhase0Block(state: CachedBeaconState<allForks.BeaconState>): phase0.Attestation[] {
    // check for phase0 block already
    const phase0State = state as CachedBeaconState<phase0.BeaconState>;
    const {epochCtx} = phase0State;
    const currentEpoch = computeEpochAtSlot(state.slot);

    const previousEpochParticipants = extractParticipation(phase0State.previousEpochAttestations, epochCtx);
    const currentEpochParticipants = extractParticipation(phase0State.currentEpochAttestations, epochCtx);

    const attestations: phase0.Attestation[] = [];

    const slots = Array.from(this.attestationGroupByDataHashBySlot.keys()).sort((a, b) => b - a);
    for (const slot of slots) {
      const attestationGroupByDataHash = this.attestationGroupByDataHashBySlot.get(slot);
      // should not happen
      if (!attestationGroupByDataHash) {
        throw Error(`No aggregated attestation pool for slot=${slot}`);
      }

      const attestationGroups = Array.from(attestationGroupByDataHash.values());
      const epoch = computeEpochAtSlot(slot);

      const participants =
        epoch === currentEpoch
          ? currentEpochParticipants
          : epoch === currentEpoch - 1
          ? previousEpochParticipants
          : null;
      if (!participants) {
        continue;
      }

      for (const attestationGroup of attestationGroups) {
        attestationGroup.removeBySeenValidators(participants);
        attestations.push(...attestationGroup.getAttestations());
      }
    }

    return attestations;
  }

  /**
   * Get attestations to be included in an altair block.
   * Attestations are sorted by inclusion distance then number of attesters.
   * Attestations should pass the validation when processing attestations in beacon-state-transition.
   */
  private getAttestationsForAltairBlock(state: CachedBeaconState<allForks.BeaconState>): phase0.Attestation[] {
    // check for altair block already
    const altairState = state as CachedBeaconState<altair.BeaconState>;
    const currentEpoch = computeEpochAtSlot(state.slot);
    const previousParticipation = altairState.previousEpochParticipation.persistent.toArray();
    const currentParticipation = altairState.currentEpochParticipation.persistent.toArray();

    const attestations: phase0.Attestation[] = [];

    const slots = Array.from(this.attestationGroupByDataHashBySlot.keys()).sort((a, b) => b - a);
    for (const slot of slots) {
      const attestationGroupByDataHash = this.attestationGroupByDataHashBySlot.get(slot);
      // should not happen
      if (!attestationGroupByDataHash) {
        throw Error(`No aggregated attestation pool for slot=${slot}`);
      }

      const attestationGroups = Array.from(attestationGroupByDataHash.values());
      const epoch = computeEpochAtSlot(slot);
      const participationStatus =
        epoch === currentEpoch ? currentParticipation : epoch === currentEpoch - 1 ? previousParticipation : null;
      if (!participationStatus) {
        continue;
      }

      for (const attestationGroup of attestationGroups) {
        const committee = attestationGroup.getCommittee();
        const seenValidatorIndices = new Set<ValidatorIndex>();
        for (const validatorIndex of committee) {
          if (participationStatus[validatorIndex] && participationStatus[validatorIndex].timelySource) {
            seenValidatorIndices.add(validatorIndex);
          }
        }

        attestationGroup.removeBySeenValidators(seenValidatorIndices);
        attestations.push(...attestationGroup.getAttestations());
      }
    }

    return attestations;
  }
}

function safeValidateAttestation(
  state: CachedBeaconState<allForks.BeaconState>,
  attestation: phase0.Attestation
): boolean {
  try {
    phase0.validateAttestation(state, attestation);
    return true;
  } catch (e) {
    return false;
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
  private readonly attestations: AttestationWithIndex[];
  private readonly committee: ValidatorIndex[];
  constructor(committee: ValidatorIndex[]) {
    this.committee = committee;
    this.attestations = [];
  }

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
    }
    return insertResult;
  }

  /** Remove all attestations with seen validators. */
  removeBySeenValidators(seenAttestingIndices: Set<ValidatorIndex>): number {
    const indicesToRemove = [];
    for (const [i, existingAttestation] of this.attestations.entries()) {
      let notSeenAttesterCount = 0;
      for (const attIndex of existingAttestation.attestingIndices) {
        if (!seenAttestingIndices.has(attIndex)) notSeenAttesterCount++;
      }
      existingAttestation.notSeenAttesterCount = notSeenAttesterCount;
      if (existingAttestation.notSeenAttesterCount === 0) {
        indicesToRemove.push(i);
      }
    }
    for (let i = indicesToRemove.length - 1; i >= 0; i--) {
      this.attestations.splice(indicesToRemove[i], 1);
    }
    return indicesToRemove.length;
  }

  /** Get unseen attestations to be included in a block or API. */
  getAttestations(): phase0.Attestation[] {
    // order by number of fresh (not-seen) attesters
    return this.attestations
      .sort((attestation1, attestation2) => {
        const freshAttesterCount1 = attestation1.notSeenAttesterCount ?? attestation1.attestingIndices.size;
        const freshAttesterCount2 = attestation2.notSeenAttesterCount ?? attestation2.attestingIndices.size;
        return freshAttesterCount2 - freshAttesterCount1;
      })
      .map((attestation) => attestation.attestation);
  }

  getCommittee(): ValidatorIndex[] {
    return this.committee;
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
