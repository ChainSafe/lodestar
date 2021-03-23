import {getAggregatorModulo, isValidatorAggregator} from "../../../src/util/aggregator";
import {config} from "@chainsafe/lodestar-config/mainnet";
import {expect} from "chai";
import {Signature} from "@chainsafe/bls";

describe("getAggregatorModulo", function () {
  it("should produce correct result", function () {
    const result = getAggregatorModulo(config, {
      slot: 1,
      committeeIndex: 2,
      committeeLength: 130,
      committeesAtSlot: 120,
      validatorCommitteeIndex: 1,
      validatorIndex: 0,
      pubkey: Buffer.alloc(48),
    });
    expect(result).to.be.equal(8);
  });
});

describe("isValidatorAggregator", function () {
  it("should be false", function () {
    const result = isValidatorAggregator(
      Signature.fromHex(
        "0x8191d16330837620f0ed85d0d3d52af5b56f7cec12658fa391814251d4b32977eb2e6ca055367354fd63175f8d1d2d7b0678c3c482b738f96a0df40bd06450d99c301a659b8396c227ed781abb37a1604297922219374772ab36b46b84817036"
      ).toBytes(),
      8
    );
    expect(result).to.be.equal(false);
  });
  it("should be true", function () {
    const result = isValidatorAggregator(
      Signature.fromHex(
        "0xa8f8bb92931234ca6d8a34530526bcd6a4cfa3bf33bd0470200dc8fa3ebdc3ba24bc8c6e994d58a0f884eb24336d746c01a29693ed0354c0862c2d5de5859e3f58747045182844d267ba232058f7df1867a406f63a1eb8afec0cf3f00a115125"
      ).toBytes(),
      8
    );
    expect(result).to.be.equal(true);
  });
});
