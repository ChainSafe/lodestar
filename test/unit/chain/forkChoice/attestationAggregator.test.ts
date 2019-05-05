import {assert} from "chai";
import BN from "bn.js";

import {
  AttestationAggregator,
  ForkChoiceAttestation,
} from "../../../../src/chain/forkChoice/statefulDag/attestationAggregator";


describe("AttestationAggregator", () => {
  const blockSlots = {
    "a": 1,
    "b": 1,
    "c": 1,
    "d": 2,
  }
  const blockToSlot = (b) => blockSlots[b];
  it("should add attestations to the same target", () => {
    const agg = new AttestationAggregator(blockToSlot);
    const target = "a";
    const weightPerAttestation = new BN(1);
    const numberOfAttestations = 10;
    for (let i = 0; i < numberOfAttestations; i++) {
      agg.addAttestation({
        target,
        attester: i,
        weight: weightPerAttestation,
      });
    }
    assert(agg.latestAggregates[target].weight.eq(weightPerAttestation.muln(numberOfAttestations)));
  });

  it("should track attestations from one attester to different targets", () => {
    const agg = new AttestationAggregator(blockToSlot);
    const target1= "a";
    const target2= "d";
    const weightPerAttestation = new BN(1);
    const numberOfAttestations = 10;
    for (let i = 0; i < numberOfAttestations; i++) {
      agg.addAttestation({
        target: target1,
        attester: i,
        weight: weightPerAttestation,
      });
    }
    assert(agg.latestAggregates[target1].weight.eq(weightPerAttestation.muln(numberOfAttestations)));
    for (let i = 0; i < numberOfAttestations / 2; i++) {
      agg.addAttestation({
        target: target2,
        attester: i,
        weight: weightPerAttestation,
      });
    }
    assert(agg.latestAggregates[target1].weight.eq(weightPerAttestation.muln(numberOfAttestations / 2)));
    assert(agg.latestAggregates[target2].weight.eq(weightPerAttestation.muln(numberOfAttestations / 2)));
  });

  it("should track attestations from one attester with different weights", () => {
    const agg = new AttestationAggregator(blockToSlot);
    const target= "a";
    const weightPerAttestation1 = new BN(1);
    const weightPerAttestation2 = new BN(10);
    const weightPerAttestation3 = new BN(5);
    const numberOfAttestations = 10;
    for (let i = 0; i < numberOfAttestations; i++) {
      agg.addAttestation({
        target: target,
        attester: i,
        weight: weightPerAttestation1,
      });
    }
    assert(agg.latestAggregates[target].weight.eq(weightPerAttestation1.muln(numberOfAttestations)));
    for (let i = 0; i < numberOfAttestations; i++) {
      agg.addAttestation({
        target: target,
        attester: i,
        weight: weightPerAttestation2,
      });
    }
    assert(agg.latestAggregates[target].weight.eq(weightPerAttestation2.muln(numberOfAttestations)));
    for (let i = 0; i < numberOfAttestations; i++) {
      agg.addAttestation({
        target: target,
        attester: i,
        weight: weightPerAttestation3,
      });
    }
    assert(agg.latestAggregates[target].weight.eq(weightPerAttestation3.muln(numberOfAttestations)));
  });

  it("should noop on duplicate or older target attestations", () => {
    const agg = new AttestationAggregator(blockToSlot);
    const target1 = "d"; // slot 2
    const target2 = "a"; // slot 1
    const weightPerAttestation = new BN(1);
    const numberOfAttestations = 10;
    for (let i = 0; i < numberOfAttestations; i++) {
      agg.addAttestation({
        target: target1,
        attester: i,
        weight: weightPerAttestation,
      });
    }
    assert(agg.latestAggregates[target1].weight.eq(weightPerAttestation.muln(numberOfAttestations)));
    for (let i = 0; i < numberOfAttestations; i++) {
      agg.addAttestation({
        target: target1,
        attester: i,
        weight: weightPerAttestation,
      });
    }
    assert(agg.latestAggregates[target1].weight.eq(weightPerAttestation.muln(numberOfAttestations)));
    for (let i = 0; i < numberOfAttestations; i++) {
      agg.addAttestation({
        target: target2,
        attester: i,
        weight: weightPerAttestation,
      });
    }
    assert(agg.latestAggregates[target1].weight.eq(weightPerAttestation.muln(numberOfAttestations)));
  });

  it("should prune aggregated attestations that no longer have attesters", () => {
    const agg = new AttestationAggregator(blockToSlot);
    const target1= "a";
    const target2= "d";
    const weightPerAttestation = new BN(1);
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
