export {memory};
import {Root, Gwei, Slot, ValidatorIndex} from "../../types";

export interface ForkChoiceAttestation {
  target: Root;
  attester: ValidatorIndex;
  weight: Gwei;
}

export interface AggregatedAttestation {
  target: Root;
  weight: Gwei;
  prevWeight: Gwei;
}

export class AttestationAggregator {
  public latestAggregates: Map<Root, AggregatedAttestation> | null = null;
  public latestAttestations: Map<ValidatorIndex, ForkChoiceAttestation> | null = null;
  public latestAggregatesValues: AggregatedAttestation[];
  public latestAttestationValues: ForkChoiceAttestation[];

  private slotLookup: (Root) => Slot | null;

  public constructor(slotLookup: (Root) => Slot | null) {
    this.latestAggregates = new Map();
    this.latestAttestations = new Map();
    this.slotLookup = slotLookup;
  }

  private ensureAggregate(target: Root): AggregatedAttestation {
    if (!this.latestAggregates.has(target)) {
      this.latestAggregates.set(target, {
        target,
        weight: 0,
        prevWeight: 0,
      });
      this.latestAggregatesValues.push({
        target,
        weight: 0,
        prevWeight: 0,
      });
    }
    return this.latestAggregates.get(target);
  }

  public addAttestation(a: ForkChoiceAttestation): void {
    if (this.latestAttestations.has(a.attester)){

      let prevA = this.latestAttestations.get(a.attester);
      let prevSlot = this.slotLookup(prevA.target);
      let newSlot = this.slotLookup(a.target);

      if(prevSlot === null || newSlot === null || prevSlot > newSlot){
        return;
      }
      let newAgg = this.ensureAggregate(a.target);
      let prevAgg = this.latestAggregates.get(prevA.weight.toString());

      if (prevA.target !== a.target) {
        prevAgg.weight -= prevA.weight ;
        newAgg.weight += a.weight;
      } else if (prevA.weight !== a.weight) {
        newAgg.weight += (a.weight - prevA.weight);
      } else {
        return;
      }

    } else{
      this.ensureAggregate(a.target);

      let aTarget = this.latestAggregates.get(a.target);
      aTarget.weight += a.weight;
    }
    this.latestAttestations.set(a.attester, a);
    this.latestAttestationValues.push(a);
  }

  public prune(): void {
    let aliveTargets: Map<Root, boolean> = new Map();
    this.latestAttestationValues.forEach((a: ForkChoiceAttestation) => aliveTargets.set(a.target, true));
    this.latestAggregatesValues.forEach((agg: AggregatedAttestation, index: i32) => {
      if (agg.prevWeight === agg.weight || !aliveTargets.get(agg.target)) {
        this.latestAggregates.delete(agg.target);
      }
    });
  }
}
