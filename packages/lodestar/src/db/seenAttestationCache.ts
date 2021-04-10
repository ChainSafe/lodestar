/**
 * simple lru cache of slot + committee index + aggregation bits hashes
 *
 */
import {phase0} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {readonlyValues, toHexString} from "@chainsafe/ssz";
import {assert} from "@chainsafe/lodestar-utils";

/**
 * USed to verify gossip attestation. When there are multiple
 * attestation from same validator
 */
export class SeenAttestationCache {
  private cache: Map<string, boolean>;
  // key as AttestationData root hex, value as aggregationBits
  private attDataCache: Map<string, boolean[]>;
  private readonly config: IBeaconConfig;
  private readonly maxSize: number;

  constructor(config: IBeaconConfig, maxSize = 1000) {
    this.config = config;
    this.maxSize = maxSize;
    this.cache = new Map<string, boolean>();
    this.attDataCache = new Map<string, boolean[]>();
  }

  addCommitteeAttestation(attestation: phase0.Attestation): void {
    const key = this.attestationKey(attestation);
    this.add(key);
  }

  addAggregateAndProof(aggregateAndProof: phase0.AggregateAndProof): void {
    const key = this.aggregateAndProofKey(aggregateAndProof);
    const cachedAggBit = this.attDataCache.get(key);
    const aggBit = Array.from(readonlyValues(aggregateAndProof.aggregate.aggregationBits));
    if (!cachedAggBit) {
      this.attDataCache.set(key, aggBit);
    } else {
      assert.equal(
        aggBit.length,
        cachedAggBit.length,
        "Length of AggregateAndProof aggregationBits is not the same to cache"
      );
      for (const [i, bit] of aggBit.entries()) {
        if (bit) cachedAggBit[i] = true;
      }
    }
    // delete oldest key if needed
    if (this.attDataCache.size > this.maxSize) {
      this.attDataCache.delete(this.attDataCache.keys().next().value);
    }
  }

  hasCommitteeAttestation(attestation: phase0.Attestation): boolean {
    const key = this.attestationKey(attestation);
    return this.cache.has(key);
  }

  hasAggregateAndProof(aggregateAndProof: phase0.AggregateAndProof): boolean {
    const key = this.aggregateAndProofKey(aggregateAndProof);
    const cachedAggBits = this.attDataCache.get(key);
    if (!cachedAggBits) return false;
    const aggBits = aggregateAndProof.aggregate.aggregationBits;
    assert.equal(
      aggBits.length,
      cachedAggBits.length,
      "Length of AggregateAndProof aggregationBits is not the same to cache"
    );
    // if there's any attester in aggregateAndProof not in cache then return false
    return !cachedAggBits.some((bit, i) => !bit && aggBits[i]);
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
   * We're only interested in the AttestationData + aggregationBits inside AggregateAndProof.
   */
  private aggregateAndProofKey(value: phase0.AggregateAndProof): string {
    return toHexString(
      this.config.getTypes(value.aggregate.data.slot).AttestationData.hashTreeRoot(value.aggregate.data)
    );
  }
}
