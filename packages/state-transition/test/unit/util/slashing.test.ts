import {assert} from "chai";

import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {Epoch, phase0, ssz} from "@lodestar/types";
import {isSlashableAttestationData} from "../../../src/util/index.js";
import {randBetween} from "../../utils/misc.js";

describe("isSlashableAttestationData", () => {
  it("Attestation data with the same target epoch should return true", () => {
    const epoch1 = randBetween(1, 1000);
    const epoch2 = epoch1 + 1;
    const a1 = getAttestationDataAt(epoch1, epoch2);
    const a2 = getAttestationDataAt(epoch1 - 1, epoch2);
    assert.isTrue(isSlashableAttestationData(a1, a2));
  });

  it("Attestation data with disjoint source/target epochs should return false", () => {
    const epoch1 = randBetween(1, 1000);
    const epoch2 = epoch1 + 1;
    const epoch3 = epoch1 + 2;
    const epoch4 = epoch1 + 3;
    const a1 = getAttestationDataAt(epoch1, epoch2);
    const a2 = getAttestationDataAt(epoch3, epoch4);
    assert.isFalse(isSlashableAttestationData(a1, a2));
  });

  it("Should return false if the second attestation does not have a greater source epoch", () => {
    // Both attestations have the same source epoch.
    const sourceEpoch1 = randBetween(1, 1000);
    const sourceEpoch2Hi = sourceEpoch1;

    const targetEpoch1 = randBetween(1, 1000);
    const targetEpoch2 = targetEpoch1 - 1;

    const a1 = getAttestationDataAt(sourceEpoch1, targetEpoch1);
    const a2Hi = getAttestationDataAt(sourceEpoch2Hi, targetEpoch2);

    assert.isFalse(isSlashableAttestationData(a1, a2Hi));

    // Second attestation has a smaller source epoch.
    const sourceEpoch2Lo = sourceEpoch1 - 1;
    const a2Lo = getAttestationDataAt(sourceEpoch2Lo, targetEpoch2);
    assert.isFalse(isSlashableAttestationData(a1, a2Lo));
  });

  it("Should return false if the second attestation does not have a smaller target epoch", () => {
    // Both attestations have the same target epoch.
    const sourceEpoch1 = randBetween(1, 1000);
    const sourceEpoch2 = sourceEpoch1 + 1;

    const targetEpoch = randBetween(2, 1000);

    // Last slot in the epoch.
    let targetSlot1 = targetEpoch * SLOTS_PER_EPOCH - 1;
    // First slot in the epoch
    let targetSlot2 = (targetEpoch - 1) * SLOTS_PER_EPOCH;

    let a1 = getAttestationDataAt(targetSlot1, sourceEpoch1);
    let a2 = getAttestationDataAt(targetSlot2, sourceEpoch2);

    assert.isFalse(isSlashableAttestationData(a1, a2));

    // Second attestation has a greater target epoch.
    targetSlot1 = targetEpoch * SLOTS_PER_EPOCH;
    targetSlot2 = (targetEpoch + 1) * SLOTS_PER_EPOCH;
    a1 = getAttestationDataAt(targetSlot1, sourceEpoch1);
    a2 = getAttestationDataAt(targetSlot2, sourceEpoch2);
    assert.isFalse(isSlashableAttestationData(a1, a2));
  });
});

function getAttestationDataAt(sourceEpoch: Epoch, targetEpoch: Epoch): phase0.AttestationDataBigint {
  const data = ssz.phase0.AttestationDataBigint.defaultValue();
  data.source.epoch = BigInt(sourceEpoch);
  data.target.epoch = BigInt(targetEpoch);
  return data;
}
