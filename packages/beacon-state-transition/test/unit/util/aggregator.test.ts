import {expect} from "chai";
import {fromHexString} from "@chainsafe/ssz";
import {
  SYNC_COMMITTEE_SIZE,
  SYNC_COMMITTEE_SUBNET_COUNT,
  TARGET_AGGREGATORS_PER_SYNC_SUBCOMMITTEE,
  TARGET_AGGREGATORS_PER_COMMITTEE,
} from "@chainsafe/lodestar-params";
import {isAggregatorFromCommitteeLength, isSyncCommitteeAggregator} from "../../../src/util/aggregator.js";

/* eslint-disable @typescript-eslint/naming-convention */

describe("isAttestationAggregator", function () {
  const committeeLength = 130;

  before("Ensure constants don't change", () => {
    expect({
      TARGET_AGGREGATORS_PER_COMMITTEE,
    }).to.deep.equal({
      TARGET_AGGREGATORS_PER_COMMITTEE: 16,
    });
  });

  it("should be false", function () {
    const result = isAggregatorFromCommitteeLength(
      committeeLength,
      fromHexString(
        "0x8191d16330837620f0ed85d0d3d52af5b56f7cec12658fa391814251d4b32977eb2e6ca055367354fd63175f8d1d2d7b0678c3c482b738f96a0df40bd06450d99c301a659b8396c227ed781abb37a1604297922219374772ab36b46b84817036"
      )
    );
    expect(result).to.be.equal(false);
  });
  it("should be true", function () {
    const result = isAggregatorFromCommitteeLength(
      committeeLength,
      fromHexString(
        "0xa8f8bb92931234ca6d8a34530526bcd6a4cfa3bf33bd0470200dc8fa3ebdc3ba24bc8c6e994d58a0f884eb24336d746c01a29693ed0354c0862c2d5de5859e3f58747045182844d267ba232058f7df1867a406f63a1eb8afec0cf3f00a115125"
      )
    );
    expect(result).to.be.equal(true);
  });
});

describe("isSyncCommitteeAggregator", function () {
  before("Ensure constants don't change", () => {
    expect({
      SYNC_COMMITTEE_SIZE,
      SYNC_COMMITTEE_SUBNET_COUNT,
      TARGET_AGGREGATORS_PER_SYNC_SUBCOMMITTEE,
    }).to.deep.equal({
      SYNC_COMMITTEE_SIZE: 512,
      SYNC_COMMITTEE_SUBNET_COUNT: 4,
      TARGET_AGGREGATORS_PER_SYNC_SUBCOMMITTEE: 16,
    });
  });

  it("should be false", function () {
    const result = isSyncCommitteeAggregator(
      fromHexString(
        "0x8191d16330837620f0ed85d0d3d52af5b56f7cec12658fa391814251d4b32977eb2e6ca055367354fd63175f8d1d2d7b0678c3c482b738f96a0df40bd06450d99c301a659b8396c227ed781abb37a1604297922219374772ab36b46b84817036"
      )
    );
    expect(result).to.be.equal(false);
  });

  // NOTE: Invalid sig, bruteforced last characters to get a true result
  it("should be true", function () {
    const result = isSyncCommitteeAggregator(
      fromHexString(
        "0xa8f8bb92931234ca6d8a34530526bcd6a4cfa3bf33bd0470200dc8fa3ebdc3ba24bc8c6e994d58a0f884eb24336d746c01a29693ed0354c0862c2d5de5859e3f58747045182844d267ba232058f7df1867a406f63a1eb8afec0cf3f00a115142"
      )
    );
    expect(result).to.be.equal(true);
  });
});
