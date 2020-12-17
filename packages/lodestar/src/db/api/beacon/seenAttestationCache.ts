/**
 * simple lru cache of slot + committee index + aggregation bits hashes
 *
 */
import {AggregateAndProof, Attestation} from "@chainsafe/lodestar-types";

/**
 * USed to verify gossip attestation. When there are multiple
 * attestation from same validator
 */
export class SeenAttestationCache {
  private cache: Map<string, boolean>;

  private readonly maxSize: number;

  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }

  public async addCommitteeAttestation(attestation: Attestation): Promise<void> {
    const key = this.attestationKey(attestation);
    this.add(key);
  }

  public async addAggregateAndProof(aggregateAndProof: AggregateAndProof): Promise<void> {
    const key = this.aggregateAndProofKey(aggregateAndProof);
    this.add(key);
  }

  public async hasCommitteeAttestation(attestation: Attestation): Promise<boolean> {
    const key = this.attestationKey(attestation);
    return this.cache.has(key);
  }

  public async hasAggregateAndProof(aggregateAndProof: AggregateAndProof): Promise<boolean> {
    const key = this.aggregateAndProofKey(aggregateAndProof);
    return this.cache.has(key);
  }

  private add(key: string): void {
    this.cache.set(key, true);
    if (this.cache.size > this.maxSize) {
      // deletes oldest element added (map keep list of insert order)
      this.cache.delete(this.cache.keys().next().value);
    }
  }

  // serialize attestation key as concatenation of interested properties
  private attestationKey(attestation: Attestation): string {
    return (
      "" +
      attestation.data.slot +
      attestation.data.index +
      Array.from(attestation.aggregationBits).reduce((result, item) => {
        result += item ? "1" : "0";
        return result;
      }, "")
    );
  }

  // serialize aggregate key as concatenation of interested properties
  private aggregateAndProofKey(aggreate: AggregateAndProof): string {
    return "" + aggreate.aggregatorIndex + aggreate.aggregate.data.target.epoch;
  }
}
