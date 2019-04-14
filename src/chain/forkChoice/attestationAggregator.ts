import BN from "bn.js";

import {Gwei, Slot, ValidatorIndex} from "../../types";


/**
 * Root is a block root as a hex string
 * Used here for light weight and easy comparison
 */
export type Root = string;

/**
 * Minimal representation of attsetation for the purposes of fork choice
 */
export interface ForkChoiceAttestation {
  target: Root;
  attester: ValidatorIndex;
  weight: Gwei;
}

/**
 * Attestation aggregated across participants
 */
export interface AggregatedAttestation {
  target: Root;
  weight: Gwei;
  prevWeight: Gwei;
}

/**
 * Keep track of the latest attestations per validator
 * as well as aggregated attestations per block root
 */
export class AttestationAggregator {

  /**
   * aggregation: target -> sum of all attestations
   */
  public latestAggregates: Record<Root, AggregatedAttestation>;

  /**
   * lookup: validator -> target + weight contributed by validator
   */
  public latestAttestations: Record<ValidatorIndex, ForkChoiceAttestation>;

  private slotLookup: (Root) => Slot | null;

  public constructor(slotLookup: (Root) => Slot | null) {
    this.latestAggregates = {};
    this.latestAttestations = {}
    this.slotLookup = slotLookup;
  }

  private ensureAggregate(target: Root): AggregatedAttestation {
    if (!this.latestAggregates[target]) {
      this.latestAggregates[target] = {
        target,
        weight: new BN(0),
        prevWeight: new BN(0),
      };
    }
    return this.latestAggregates[target];
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
      const newAgg = this.ensureAggregate(a.target);
      const prevAgg = this.latestAggregates[prevA.target];
      if (prevA.target !== a.target) { // new attestation target
        prevAgg.weight = prevAgg.weight.sub(prevA.weight);
        newAgg.weight = newAgg.weight.add(a.weight);
      } else if (!prevA.weight.eq(a.weight)) { // new attestation weight
        newAgg.weight = newAgg.weight.add(a.weight.sub(prevA.weight));
      } else {
        return;
      }
    } else {
      // No parent indiviidual attestation exists yet
      this.ensureAggregate(a.target);
      this.latestAggregates[a.target].weight = this.latestAggregates[a.target].weight.add(a.weight);
    }
    // update individual attestation
    this.latestAttestations[a.attester] = a;
  }

  /**
   * Remove all unused aggregations
   * Note: latestAttestations is currently never pruned
   */
  public prune(): void {
    const aliveTargets: Record<Root, boolean> = {};
    Object.values(this.latestAttestations).forEach((a) => aliveTargets[a.target] = true);
    Object.values(this.latestAggregates).forEach((agg) => {
      if (agg.prevWeight.eq(agg.weight) || !aliveTargets[agg.target]) {
        delete this.latestAggregates[agg.target];
      }
    });
  }
}
