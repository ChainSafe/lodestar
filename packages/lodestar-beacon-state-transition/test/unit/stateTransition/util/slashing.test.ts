import {assert} from "chai";

import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {Epoch, Slot} from "@chainsafe/lodestar-types";
import {randBetween} from "../../../utils/misc";
import {isSlashableAttestationData} from "../../../../src/util";
import {generateAttestationData} from "../../../utils/attestation";


describe("isSlashableAttestationData", () => {
  it("Attestation data with the same target epoch should return true", () => {
    const epoch1: Epoch = BigInt(randBetween(1, 1000));
    const epoch2: Epoch = epoch1 + 1n;
    const a1 = generateAttestationData(epoch1, epoch2);
    const a2 = generateAttestationData(epoch1-1n, epoch2);
    assert.isTrue(isSlashableAttestationData(config, a1, a2));
  });

  it("Attestation data with disjoint source/target epochs should return false", () => {
    const epoch1: Epoch = BigInt(randBetween(1, 1000));
    const epoch2 = epoch1 + 1n;
    const epoch3 = epoch2 + 1n;
    const epoch4 = epoch3 + 1n;
    const a1 = generateAttestationData(epoch1, epoch2);
    const a2 = generateAttestationData(epoch3, epoch4);
    assert.isFalse(isSlashableAttestationData(config, a1, a2));
  });

  it("Should return false if the second attestation does not have a greater source epoch", () => {
    // Both attestations have the same source epoch.
    const sourceEpoch1: Epoch = BigInt(randBetween(1, 1000));
    let sourceEpoch2: Epoch = sourceEpoch1;

    const targetEpoch1: Epoch = BigInt(randBetween(1, 1000));
    const targetEpoch2: Epoch = targetEpoch1 - 1n;

    const a1 = generateAttestationData(sourceEpoch1, targetEpoch1);
    let a2 = generateAttestationData(sourceEpoch2, targetEpoch2);

    assert.isFalse(isSlashableAttestationData(config, a1, a2));

    // Second attestation has a smaller source epoch.
    sourceEpoch2 = sourceEpoch1 - 1n;
    a2 = generateAttestationData(sourceEpoch2, targetEpoch2);
    assert.isFalse(isSlashableAttestationData(config, a1, a2));
  });

  it("Should return false if the second attestation does not have a smaller target epoch", () => {
    // Both attestations have the same target epoch.
    const sourceEpoch1: Epoch = BigInt(randBetween(1, 1000));
    const sourceEpoch2: Epoch = sourceEpoch1 + 1n;

    const targetEpoch: Epoch = BigInt(randBetween(2, 1000));

    // Last slot in the epoch.
    let targetSlot1: Slot = targetEpoch * config.params.SLOTS_PER_EPOCH - 1n;
    // First slot in the epoch
    let targetSlot2: Slot = (targetEpoch - 1n) * config.params.SLOTS_PER_EPOCH;

    let a1 = generateAttestationData(targetSlot1, sourceEpoch1);
    let a2 = generateAttestationData(targetSlot2, sourceEpoch2);

    assert.isFalse(isSlashableAttestationData(config, a1, a2));

    // Second attestation has a greater target epoch.
    targetSlot1 = targetEpoch * config.params.SLOTS_PER_EPOCH;
    targetSlot2 = (targetEpoch + 1n) * config.params.SLOTS_PER_EPOCH;
    a1 = generateAttestationData(targetSlot1, sourceEpoch1);
    a2 = generateAttestationData(targetSlot2, sourceEpoch2);
    assert.isFalse(isSlashableAttestationData(config, a1, a2));
  });
});
