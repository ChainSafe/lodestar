/**
 * simple lru cache of slot + committee index + aggregation bits hashes
 *
 */
import {phase0} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {toHexString} from "@chainsafe/ssz";

/**
 * USed to verify gossip attestation. When there are multiple
 * attestation from same validator
 */
export class SeenAttestationCache {
  private cache: Map<string, boolean>;
  private readonly config: IBeaconConfig;
  private readonly maxSize: number;

  constructor(config: IBeaconConfig, maxSize = 1000) {
    this.config = config;
    this.maxSize = maxSize;
    this.cache = new Map<string, boolean>();
  }

  addCommitteeAttestation(attestation: phase0.Attestation): void {
    const key = this.attestationKey(attestation);
    this.add(key);
  }

  addAggregateAndProof(aggregateAndProof: phase0.AggregateAndProof): void {
    const key = this.aggregateAndProofKey(aggregateAndProof);
    this.add(key);
  }

  hasCommitteeAttestation(attestation: phase0.Attestation): boolean {
    const key = this.attestationKey(attestation);
    return this.cache.has(key);
  }

  hasAggregateAndProof(aggregateAndProof: phase0.AggregateAndProof): boolean {
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
  private attestationKey(attestation: phase0.Attestation): string {
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

  /**
   * We're only interested in the Attestation inside AggregateAndProof.
   */
  private aggregateAndProofKey(value: phase0.AggregateAndProof): string {
    return toHexString(this.config.types.phase0.Attestation.hashTreeRoot(value.aggregate));
  }
}
