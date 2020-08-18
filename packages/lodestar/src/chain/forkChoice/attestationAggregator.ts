/* eslint-disable @typescript-eslint/interface-name-prefix */
/**
 * @module chain/forkChoice
 */

import {Slot, ValidatorIndex} from "@chainsafe/lodestar-types";
import {RootHex, AggregatedAttestation, ForkChoiceAttestation} from "./interface";

/**
 * Keep track of the latest attestations per validator
 * as well as aggregated attestations per block root
 */
export class AttestationAggregator {

  /**
   * aggregation: target -> sum of all attestations
   */
  public latestAggregates: Record<RootHex, AggregatedAttestation>;

  /**
   * lookup: validator -> target + weight contributed by validator
   */
  public latestAttestations: Record<ValidatorIndex, ForkChoiceAttestation>;

  /**
   * Rather than storing the slot on every attestation, a lookup function is required
   */
  private slotLookup: (Root: string) => Slot | null;

  public constructor(slotLookup: (Root: string) => Slot | null) {
    this.latestAggregates = {};
    this.latestAttestations = {};
    this.slotLookup = slotLookup;
  }

  /**
   * Add an attestion into the aggregator
   */
  public addAttestation(a: ForkChoiceAttestation): void {
    const prevA = this.latestAttestations[a.attester];
    if (prevA) {
      // Previous individual attestation exists
      const prevSlot = this.slotLookup(prevA.target);
      const newSlot = this.slotLookup(a.target);
      if (prevSlot === null || newSlot === null || prevSlot > newSlot) {
        // new attestation is not new enough or slot doesn't exist
        return;
      }
      const prevAgg = this.ensureAggregate(prevA.target);
      const newAgg = this.ensureAggregate(a.target);
      if (prevAgg.target !== newAgg.target) { // new attestation target
        prevAgg.weight -=  prevA.weight;
        newAgg.weight += a.weight;
      } else if (!(prevA.weight === a.weight)) { // new attestation weight
        newAgg.weight += a.weight - prevA.weight;
      } else {
        return;
      }
    } else {
      // No parent indiviidual attestation exists yet
      this.ensureAggregate(a.target);
      this.latestAggregates[a.target].weight += a.weight;
    }
    // update individual attestation
    this.latestAttestations[a.attester] = a;
  }

  /**
   * Remove all unused aggregations
   *
   * Note: latestAttestations is currently never pruned
   */
  public prune(): void {
    const aliveTargets: Record<RootHex, boolean> = {};
    Object.values(this.latestAttestations).forEach((a) => aliveTargets[a.target] = true);
    Object.values(this.latestAggregates).forEach((agg) => {
      if (agg.prevWeight === agg.weight || !aliveTargets[agg.target]) {
        delete this.latestAggregates[agg.target];
      }
    });
  }

  private ensureAggregate(target: RootHex): AggregatedAttestation {
    if (!this.latestAggregates[target]) {
      this.latestAggregates[target] = {
        target,
        weight: BigInt(0),
        prevWeight: BigInt(0),
      };
    }
    return this.latestAggregates[target];
  }
}
