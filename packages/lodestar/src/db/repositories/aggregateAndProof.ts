import {ArrayLike, BitList} from "@chainsafe/ssz";
import {phase0, allForks, Epoch, Slot} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {computeStartSlotAtEpoch, isValidAttestationSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {IDatabaseController, Bucket, Repository} from "@chainsafe/lodestar-db";

// TODO: Could this repository be indexed by slot?
//       That would make block production and finalized pruning much more efficient
/**
 * AggregateAndProof indexed by root
 *
 * Added via gossip or api
 * Removed when included on chain or old
 */
export class AggregateAndProofRepository extends Repository<Uint8Array, phase0.AggregateAndProof> {
  constructor(config: IBeaconConfig, db: IDatabaseController<Buffer, Buffer>) {
    super(config, db, Bucket.phase0_aggregateAndProof, config.types.phase0.AggregateAndProof);
  }

  /**
   * Id is hashTreeRoot of aggregated attestation
   */
  getId(value: phase0.AggregateAndProof): Uint8Array {
    return this.getIdFromAttestation(value.aggregate);
  }

  async getBlockAttestations(state: allForks.BeaconState): Promise<phase0.Attestation[]> {
    const stateSlot = state.slot;
    const aggregatesAndProof: phase0.AggregateAndProof[] = await this.values();
    const validAggregatesScored: {aggregate: phase0.Attestation; score: number}[] = [];

    for (const aggregateAndProof of aggregatesAndProof) {
      // Attestation should be unique because we store by its id
      const aggregate = aggregateAndProof.aggregate;
      if (isValidAttestationSlot(this.config, aggregate.data.slot, state.slot)) {
        validAggregatesScored.push({aggregate, score: computeAttestationValueScore(aggregate, stateSlot)});
      }
    }

    // Prefer most valuable aggregates
    return validAggregatesScored.sort((a, b) => b.score - a.score).map((a) => a.aggregate);
  }

  async removeIncluded(attestations: ArrayLike<phase0.Attestation>): Promise<void> {
    const ids: Uint8Array[] = [];
    for (const attestation of attestations) {
      ids.push(this.getIdFromAttestation(attestation));
    }

    await this.batchDelete(ids);
  }

  async pruneFinalized(finalizedEpoch: Epoch): Promise<void> {
    const finalizedEpochStartSlot = computeStartSlotAtEpoch(this.config, finalizedEpoch);
    const entries = await this.entries();
    const idsToDelete = entries.filter((e) => e.value.aggregate.data.slot < finalizedEpochStartSlot).map((e) => e.key);
    await this.batchDelete(idsToDelete);
  }

  private getIdFromAttestation(attestation: phase0.Attestation): Uint8Array {
    return this.config.types.phase0.Attestation.hashTreeRoot(attestation);
  }
}

function computeAttestationValueScore(attestation: phase0.Attestation, toBeIncludedSlot: Slot): number {
  const inclusionDelay = Math.min(toBeIncludedSlot - attestation.data.slot, 1);
  const totalBits = sumBits(attestation.aggregationBits);
  return totalBits / inclusionDelay;
}

function sumBits(aggregationBits: BitList): number {
  let total = 0;
  for (let i = 0, len = aggregationBits.length; i < len; i++) {
    if (aggregationBits[i]) total++;
  }
  return total;
}
