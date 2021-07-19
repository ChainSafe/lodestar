import bls from "@chainsafe/bls";
import {SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {allForks, Slot, ssz, ValidatorIndex} from "@chainsafe/lodestar-types";
import {CachedBeaconState, phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {List, toHexString} from "@chainsafe/ssz";
import {MapDef} from "../../util/map";
import {pruneBySlot} from "./utils";
import {InsertOutcome} from "./types";

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
  // no need to maintain lowestPermissibleSlot since it's checked via gossip validation fn
  add(attestation: phase0.Attestation, attestingIndices: ValidatorIndex[], committee: ValidatorIndex[]): InsertOutcome {
    const slot = attestation.data.slot;
    const attestationGroupByDataHash = this.attestationGroupByDataHashBySlot.getOrDefault(slot);
    const dataRoot = ssz.phase0.AttestationData.hashTreeRoot(attestation.data);
    const dataRootHex = toHexString(dataRoot);
    let attestationGroup = attestationGroupByDataHash.get(dataRootHex);
    if (attestationGroup) {
      return attestationGroup.add({attestation, attestingIndices});
    } else {
      attestationGroup = new MatchingDataAttestationGroup({attestation, attestingIndices}, committee);
      attestationGroupByDataHash.set(dataRootHex, attestationGroup);
      return InsertOutcome.NewData;
    }
  }

  /** Remove attestations included in the chain, return number of attestations removed */
  removeIncluded(attestation: phase0.Attestation, attestingIndices: ValidatorIndex[]): number {
    const slot = attestation.data.slot;
    const attestationGroupByDataHash = this.attestationGroupByDataHashBySlot.get(slot);
    if (!attestationGroupByDataHash) {
      return 0;
    }
    const dataRoot = ssz.phase0.AttestationData.hashTreeRoot(attestation.data);
    const dataRootHex = toHexString(dataRoot);
    const attestationGroup = attestationGroupByDataHash.get(dataRootHex);
    if (!attestationGroup) {
      return 0;
    }
    return attestationGroup.removeIncluded({attestation, attestingIndices});
  }

  /** Remove attestations which are too old to be included in a block. */
  prune(clockSlot: Slot): void {
    // Only retain SLOTS_PER_EPOCH slots
    pruneBySlot(this.attestationGroupByDataHashBySlot, clockSlot, SLOTS_PER_EPOCH);
  }

  /**
   * Get attestations to be included in a block.
   * Attestations are sorted by inclusion distance then number of attesters.
   * Attestations should pass the validation when processing attestations in beacon-state-transition.
   */
  getAttestationsForBlock(state: CachedBeaconState<allForks.BeaconState>): phase0.Attestation[] {
    const slots = Array.from(this.attestationGroupByDataHashBySlot.keys()).sort((a, b) => b - a);
    const attestations: phase0.Attestation[] = [];
    for (const slot of slots) {
      const attestationGroupByDataHash = this.attestationGroupByDataHashBySlot.get(slot);
      // should not happen
      if (!attestationGroupByDataHash) {
        throw Error(`No aggregated attestation pool for slot=${slot}`);
      }
      const attestationGroups = Array.from(attestationGroupByDataHash.values());
      attestations.push(...attestationGroups.map((group) => group.getAttestations()).flat());
    }
    // consumer should limit MAX_ATTESTATIONS items
    return attestations.filter((attestation) => safeValidateAttestation(state, attestation));
  }

  /**
   * Get all attestations optionally filtered by `attestation.data.slot`
   * @param bySlot slot to filter, `bySlot === attestation.data.slot`
   */
  getAll(bySlot?: Slot): phase0.Attestation[] {
    const attestationGroupByDataHashs =
      bySlot === undefined
        ? Array.from(this.attestationGroupByDataHashBySlot.values())
        : [this.attestationGroupByDataHashBySlot.get(bySlot)];
    const attestations: phase0.Attestation[] = [];
    for (const attestationGroupByDataHash of attestationGroupByDataHashs) {
      if (attestationGroupByDataHash) {
        attestations.push(
          ...Array.from(attestationGroupByDataHash.values())
            .map((group) => group.getAttestations())
            .flat()
        );
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
  attestingIndices: ValidatorIndex[];
}

/**
 * Maintain a pool of AggregatedAttestation which all share the same AttestationData.
 * Preaggregate into smallest number of attestations.
 * When getting attestations to be included in a block, sort by number of attesters.
 * Use committee instead of aggregationBits to improve performance.
 */
export class MatchingDataAttestationGroup {
  private readonly attestations: AttestationWithIndex[];
  // Manage seenValidators by a regular set instead of aggregationBits to improve performance
  private readonly seenValidators = new Set<ValidatorIndex>();
  private readonly committee: ValidatorIndex[];
  constructor(attestation: AttestationWithIndex, committee: ValidatorIndex[]) {
    this.committee = committee;
    this.attestations = [attestation];
  }

  /** Add an attestation. */
  add(attestation: AttestationWithIndex): InsertOutcome {
    const attestingIndices = attestation.attestingIndices.valueOf() as ValidatorIndex[];
    if (attestingIndices.every((attestingIndex) => this.seenValidators.has(attestingIndex))) {
      // We've already seen these attesters
      return InsertOutcome.AlreadyKnown;
    }
    // preaggregate
    let aggregated = false;
    for (const existingAttestation of this.attestations) {
      const existingAttestingIndices = existingAttestation.attestingIndices.valueOf() as ValidatorIndex[];
      // no intersection
      if (
        new Set([...attestingIndices, ...existingAttestingIndices]).size ===
        attestingIndices.length + existingAttestingIndices.length
      ) {
        aggregated = true;
        aggregateInto(existingAttestation, attestation, this.committee);
      }
    }
    if (!aggregated) {
      this.attestations.push(attestation);
    }
    return aggregated ? InsertOutcome.Aggregated : InsertOutcome.NewData;
  }

  /** See an attestation from the chain, remove all attestations with seen validators. */
  removeIncluded(attestation: AttestationWithIndex): number {
    const attestingIndices = attestation.attestingIndices.valueOf() as ValidatorIndex[];
    let seeAll = true;
    for (const attester of attestingIndices) {
      if (!this.seenValidators.has(attester)) {
        seeAll = false;
        this.seenValidators.add(attester);
      }
    }
    if (seeAll) {
      // We've already seen and filtered out these attesters, nothing to do
      return 0;
    }
    let index = this.attestations.length - 1;
    let numRemoved = 0;
    while (index >= 0) {
      const existingAttestation = this.attestations[index];
      if (existingAttestation.attestingIndices.every((attestingIndex) => this.seenValidators.has(attestingIndex))) {
        this.attestations.splice(index, 1);
        numRemoved++;
      }
      index--;
    }
    return numRemoved;
  }

  /** Get unseen attestations to be included in a block or API. */
  getAttestations(): phase0.Attestation[] {
    // order by num attestingIndices desc
    return this.attestations
      .sort((attestation1, attestation2) => attestation2.attestingIndices.length - attestation1.attestingIndices.length)
      .map((attestation) => attestation.attestation);
  }
}

export function aggregateInto(
  attestation1: AttestationWithIndex,
  attestation2: AttestationWithIndex,
  committee: ValidatorIndex[]
): void {
  const attestingIndices = [
    ...(attestation1.attestingIndices.valueOf() as ValidatorIndex[]),
    ...(attestation2.attestingIndices.valueOf() as ValidatorIndex[]),
  ];
  attestation1.attestation.aggregationBits = Array.from({length: committee.length}, (_, i) =>
    attestingIndices.includes(committee[i])
  ) as List<boolean>;
  attestation1.attestingIndices = attestingIndices;
  const signature1 = bls.Signature.fromBytes(attestation1.attestation.signature.valueOf() as Uint8Array);
  const signature2 = bls.Signature.fromBytes(attestation2.attestation.signature.valueOf() as Uint8Array);
  attestation1.attestation.signature = bls.Signature.aggregate([signature1, signature2]).toBytes();
}
