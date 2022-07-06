import {expect} from "chai";
import {SYNC_COMMITTEE_SUBNET_SIZE} from "@lodestar/params";
import {syncCommitteeIndicesToSubnets} from "../../../src/services/utils.js";

describe("services / utils / syncCommitteeIndicesToSubnets", () => {
  before("Check SYNC_COMMITTEE_SUBNET_SIZE", () => {
    expect(SYNC_COMMITTEE_SUBNET_SIZE).equals(128);
  });

  const testCases: {indexes: number[]; subnets: number[]}[] = [
    {indexes: [], subnets: []},
    {indexes: [0], subnets: [0]},
    {indexes: [0, 1, 2], subnets: [0]},
    {indexes: [0, 128, 256, 384], subnets: [0, 1, 2, 3]},
    {indexes: [0, 1, 128, 129, 256, 257, 384, 385], subnets: [0, 1, 2, 3]},
    // Non-sorted case
    {indexes: [256, 0, 1, 2], subnets: [2, 0]},
  ];

  for (const {indexes, subnets} of testCases) {
    it(indexes.join(","), () => {
      expect(syncCommitteeIndicesToSubnets(indexes)).deep.equals(subnets);
    });
  }
});
