// @ts-ignore
export {memory};
import {Root, Gwei, Slot, ValidatorIndex} from "../../types";

class Aggregate {
  public target: Root;
  public weight: Gwei;
  public prevWeight: Gwei;
  public constructor(target: Root, weight: Gwei, prevWeight: Gwei) {
    this.target = target;
    this.weight = weight;
    this.prevWeight = prevWeight;
  }
}

class Attestation {
  public target: Root;
  public attester: ValidatorIndex;
  public weight: Gwei;
  public constructor(target: Root, attester: ValidatorIndex, weight: Gwei) {
    this.target = target;
    this.attester = attester;
    this.weight = weight;
  }
}

export class AttestationAggregator {
  public latestAggregates: Map<Root, Aggregate>;
  public latestAttestations: Map<ValidatorIndex, Attestation>;
  public latestAggregatesValues: Aggregate[];
  public latestAttestationValues: Attestation[];
  private slotLookup: (arg0: Root) => Slot | null;

  public constructor(slotLookup: (arg0: Root) => Slot | null) {
    this.latestAggregates = new Map();
    this.latestAttestations = new Map();
    this.slotLookup = slotLookup;
  }

  private ensureAggregate(target: Root): Aggregate {
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

  public addAttestation(a: Attestation): void {
    if (this.latestAttestations.has(a.attester)){

      let prevA = this.latestAttestations.get(a.attester);
      let prevSlot = this.slotLookup(prevA.target);
      let newSlot = this.slotLookup(a.target);

      if(prevSlot === null || newSlot === null || prevSlot > newSlot){
        return;
      }
      let newAgg = this.ensureAggregate(a.target);
      // @ts-ignore // It can't find toString()
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
    this.latestAttestationValues.forEach((a) => aliveTargets.set(a.target, true));
    this.latestAggregatesValues.forEach((agg, index: i32) => {
      if (agg.prevWeight === agg.weight || !aliveTargets.get(agg.target)) {
        this.latestAggregates.delete(agg.target);
      }
    });
  }

}
