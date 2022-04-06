import {assert} from "chai";

import {SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {Epoch, Slot} from "@chainsafe/lodestar-types";
import {isSlashableAttestationData} from "../../../src/util/index.js";
import {randBetween} from "../../utils/misc.js";
import {generateAttestationData} from "../../utils/attestation.js";

describe("isSlashableAttestationData", () => {
  it("Attestation data with the same target epoch should return true", () => {
    const epoch1: Epoch = randBetween(1, 1000);
    const epoch2: Epoch = epoch1 + 1;
    const a1 = generateAttestationData(epoch1, epoch2);
    const a2 = generateAttestationData(epoch1 - 1, epoch2);
    assert.isTrue(isSlashableAttestationData(a1, a2));
  });

  it("Attestation data with disjoint source/target epochs should return false", () => {
    const epoch1: Epoch = randBetween(1, 1000);
    const epoch2 = epoch1 + 1;
    const epoch3 = epoch2 + 1;
    const epoch4 = epoch3 + 1;
    const a1 = generateAttestationData(epoch1, epoch2);
    const a2 = generateAttestationData(epoch3, epoch4);
    assert.isFalse(isSlashableAttestationData(a1, a2));
  });

  it("Should return false if the second attestation does not have a greater source epoch", () => {
    // Both attestations have the same source epoch.
    const sourceEpoch1: Epoch = randBetween(1, 1000);
    let sourceEpoch2: Epoch = sourceEpoch1;

    const targetEpoch1: Epoch = randBetween(1, 1000);
    const targetEpoch2: Epoch = targetEpoch1 - 1;

    const a1 = generateAttestationData(sourceEpoch1, targetEpoch1);
    let a2 = generateAttestationData(sourceEpoch2, targetEpoch2);

    assert.isFalse(isSlashableAttestationData(a1, a2));

    // Second attestation has a smaller source epoch.
    sourceEpoch2 = sourceEpoch1 - 1;
    a2 = generateAttestationData(sourceEpoch2, targetEpoch2);
    assert.isFalse(isSlashableAttestationData(a1, a2));
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

    assert.isFalse(isSlashableAttestationData(a1, a2));

    // Second attestation has a greater target epoch.
    targetSlot1 = targetEpoch * SLOTS_PER_EPOCH;
    targetSlot2 = (targetEpoch + 1) * SLOTS_PER_EPOCH;
    a1 = generateAttestationData(targetSlot1, sourceEpoch1);
    a2 = generateAttestationData(targetSlot2, sourceEpoch2);
    assert.isFalse(isSlashableAttestationData(a1, a2));
  });
});
