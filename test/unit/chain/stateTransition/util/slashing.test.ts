import { assert } from "chai";

import { Epoch, Slot } from "../../../../../src/types";
import { SLOTS_PER_EPOCH } from "../../../../../src/constants";

import {
  isDoubleVote,
  isSurroundVote,
} from "../../../../../src/chain/stateTransition/util/slashing";

import { generateAttestationData } from "../../../../utils/attestation";
import { randBetween } from "../../../../utils/misc";


describe("isDoubleVote", () => {
  it("Attestation data with the same epoch should return true", () => {
    const epoch: Epoch = randBetween(1, 1000);
    const slot1: Slot = epoch * SLOTS_PER_EPOCH;
    const slot2: Slot = slot1 + SLOTS_PER_EPOCH - 1;
    const a1 = generateAttestationData(slot1, randBetween(1, 1000));
    const a2 = generateAttestationData(slot2, randBetween(1, 1000));
    assert.isTrue(isDoubleVote(a1, a2));
  });

  it("Attestation data with different epochs should return false", () => {
    const epoch: Epoch = randBetween(1, 1000);
    const slot1: Slot = epoch * SLOTS_PER_EPOCH;
    const slot2: Slot = slot1 - 1;
    const a1 = generateAttestationData(slot1, randBetween(1, 1000));
    const a2 = generateAttestationData(slot2, randBetween(1, 1000));
    assert.isFalse(isDoubleVote(a1, a2));
  });
});

describe("isSurroundVote", () => {
  it("Attestation data with the same epoch should return true", () => {
    const sourceEpoch1: Epoch = randBetween(1, 1000);
    const sourceEpoch2: Epoch = sourceEpoch1 + 1;

    const targetEpoch1: Epoch = randBetween(1, 1000);
    const targetEpoch2: Epoch = targetEpoch1 - 1;

    const targetSlot1: Slot = targetEpoch1 * SLOTS_PER_EPOCH;
    const targetSlot2: Slot = targetEpoch2 * SLOTS_PER_EPOCH;

    const a1 = generateAttestationData(targetSlot1, sourceEpoch1);
    const a2 = generateAttestationData(targetSlot2, sourceEpoch2);

    assert.isTrue(isSurroundVote(a1, a2));
  });

  it("Should return false if the second attestation does not have a greater source epoch", () => {
    // Both attestations have the same source epoch.
    const sourceEpoch1: Epoch = randBetween(1, 1000);
    let sourceEpoch2: Epoch = sourceEpoch1;

    const targetEpoch1: Epoch = randBetween(1, 1000);
    const targetEpoch2: Epoch = targetEpoch1 - 1;

    const targetSlot1: Slot = targetEpoch1 * SLOTS_PER_EPOCH;
    const targetSlot2: Slot = targetEpoch2 * SLOTS_PER_EPOCH;

    const a1 = generateAttestationData(targetSlot1, sourceEpoch1);
    let a2 = generateAttestationData(targetSlot2, sourceEpoch2);

    assert.isFalse(isSurroundVote(a1, a2));

    // Second attestation has a smaller source epoch.
    sourceEpoch2 = sourceEpoch1 - 1;
    a2 = generateAttestationData(targetSlot2, sourceEpoch2);
    assert.isFalse(isSurroundVote(a1, a2));
  });

  it("Should return false if the second attestation does not have a smaller target epoch", () => {
    // Both attestations have the same target epoch.
    const sourceEpoch1: Epoch = randBetween(1, 1000);
    const sourceEpoch2: Epoch = sourceEpoch1 + 1;

    const targetEpoch: Epoch = randBetween(2, 1000);

    // Last slot in the epoch.
    let targetSlot1: Slot = targetEpoch * SLOTS_PER_EPOCH - 1;
    // First slot in the epoch
    let targetSlot2: Slot = (targetEpoch - 1) * SLOTS_PER_EPOCH;

    let a1 = generateAttestationData(targetSlot1, sourceEpoch1);
    let a2 = generateAttestationData(targetSlot2, sourceEpoch2);

    assert.isFalse(isSurroundVote(a1, a2));

    // Second attestation has a greater target epoch.
    targetSlot1 = targetEpoch * SLOTS_PER_EPOCH;
    targetSlot2 = (targetEpoch + 1) * SLOTS_PER_EPOCH;
    a1 = generateAttestationData(targetSlot1, sourceEpoch1);
    a2 = generateAttestationData(targetSlot2, sourceEpoch2);
    assert.isFalse(isSurroundVote(a1, a2));
  });
});
