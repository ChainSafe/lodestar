import {assert} from "chai";

import {
  AttestationAggregator,
} from "../../../../src/chain/forkChoice/statefulDag/attestationAggregator";


describe("AttestationAggregator", () => {
  const blockSlots: Record<string, number> = {
    "a": 1,
    "b": 1,
    "c": 1,
    "d": 2,
  }
  const blockToSlot: any = (b: string) => blockSlots[b];
  it("should add attestations to the same target", () => {
    const agg = new AttestationAggregator(blockToSlot);
    const target = "a";
    const weightPerAttestation = 1n;
    const numberOfAttestations = 10;
    for (let i = 0; i < numberOfAttestations; i++) {
      agg.addAttestation({
        target,
        attester: i,
        weight: weightPerAttestation,
      });
    }
    assert(agg.latestAggregates[target].weight === (weightPerAttestation * BigInt(numberOfAttestations)));
  });

  it("should track attestations from one attester to different targets", () => {
    const agg = new AttestationAggregator(blockToSlot);
    const target1= "a";
    const target2= "d";
    const weightPerAttestation = 1n;
    const numberOfAttestations = 10;
    for (let i = 0; i < numberOfAttestations; i++) {
      agg.addAttestation({
        target: target1,
        attester: i,
        weight: weightPerAttestation,
      });
    }
    assert(agg.latestAggregates[target1].weight === weightPerAttestation * BigInt(numberOfAttestations));
    for (let i = 0; i < numberOfAttestations / 2; i++) {
      agg.addAttestation({
        target: target2,
        attester: i,
        weight: weightPerAttestation,
      });
    }
    assert(agg.latestAggregates[target1].weight === weightPerAttestation * BigInt(numberOfAttestations / 2));
    assert(agg.latestAggregates[target2].weight === weightPerAttestation * BigInt(numberOfAttestations / 2));
  });

  it("should track attestations from one attester with different weights", () => {
    const agg = new AttestationAggregator(blockToSlot);
    const target= "a";
    const weightPerAttestation1 = 1n;
    const weightPerAttestation2 = 10n;
    const weightPerAttestation3 = 5n;
    const numberOfAttestations = 10;
    for (let i = 0; i < numberOfAttestations; i++) {
      agg.addAttestation({
        target: target,
        attester: i,
        weight: weightPerAttestation1,
      });
    }
    assert(agg.latestAggregates[target].weight === weightPerAttestation1 * BigInt(numberOfAttestations));
    for (let i = 0; i < numberOfAttestations; i++) {
      agg.addAttestation({
        target: target,
        attester: i,
        weight: weightPerAttestation2,
      });
    }
    assert(agg.latestAggregates[target].weight === weightPerAttestation2 * BigInt(numberOfAttestations));
    for (let i = 0; i < numberOfAttestations; i++) {
      agg.addAttestation({
        target: target,
        attester: i,
        weight: weightPerAttestation3,
      });
    }

    assert(agg.latestAggregates[target].weight === weightPerAttestation3 * BigInt(numberOfAttestations));
  });

  it("should noop on duplicate or older target attestations", () => {
    const agg = new AttestationAggregator(blockToSlot);
    const target1 = "d"; // slot 2
    const target2 = "a"; // slot 1
    const weightPerAttestation = 1n;
    const numberOfAttestations = 10;
    for (let i = 0; i < numberOfAttestations; i++) {
      agg.addAttestation({
        target: target1,
        attester: i,
        weight: weightPerAttestation,
      });
    }
    assert(agg.latestAggregates[target1].weight === weightPerAttestation * BigInt(numberOfAttestations));
    for (let i = 0; i < numberOfAttestations; i++) {
      agg.addAttestation({
        target: target1,
        attester: i,
        weight: weightPerAttestation,
      });
    }
    assert(agg.latestAggregates[target1].weight === weightPerAttestation * BigInt(numberOfAttestations));
    for (let i = 0; i < numberOfAttestations; i++) {
      agg.addAttestation({
        target: target2,
        attester: i,
        weight: weightPerAttestation,
      });
    }
    assert(agg.latestAggregates[target1].weight === weightPerAttestation * BigInt(numberOfAttestations));
  });

  it("should prune aggregated attestations that no longer have attesters", () => {
    const agg = new AttestationAggregator(blockToSlot);
    const target1= "a";
    const target2= "d";
    const weightPerAttestation = 1n;
    const numberOfAttestations = 10;
    for (let i = 0; i < numberOfAttestations; i++) {
      agg.addAttestation({
        target: target1,
        attester: i,
        weight: weightPerAttestation,
      });
    }
    for (let i = 0; i < numberOfAttestations; i++) {
      agg.addAttestation({
        target: target2,
        attester: i,
        weight: weightPerAttestation,
      });
    }
    agg.prune();
    assert(agg.latestAggregates[target1] === undefined);
  });

});
