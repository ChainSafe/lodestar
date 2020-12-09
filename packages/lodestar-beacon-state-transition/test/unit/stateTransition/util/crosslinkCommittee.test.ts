/*
import {assert} from "chai";

import {
  computeShuffledIndex,
  getCommitteeCountAtSlot,
  computeCommittee,
  getBeaconCommittee,
} from "../../../../src/util";


describe("getEpochCommitteeCount", () => {
  // this defines the # of validators required to have 1 committee
  // per slot for epoch length.
  const validatorsPerEpoch = SLOTS_PER_EPOCH * TARGET_COMMITTEE_SIZE;
  const tests = [
    {validatorCount: 0, committeeCount: SLOTS_PER_EPOCH},
    {validatorCount: 1000, committeeCount: SLOTS_PER_EPOCH},
    {validatorCount: 2 * validatorsPerEpoch, committeeCount: 2 * SLOTS_PER_EPOCH},
    {validatorCount: 5 * validatorsPerEpoch, committeeCount: 5 * SLOTS_PER_EPOCH},
    {validatorCount: 16 * validatorsPerEpoch, committeeCount: 16 * SLOTS_PER_EPOCH},
    {validatorCount: 32 * validatorsPerEpoch, committeeCount: 16 * SLOTS_PER_EPOCH},
  ];
  for (const {validatorCount, committeeCount} of tests) {
    assert.equal(getEpochCommitteeCount(validatorCount), committeeCount);
  }
});
*/
