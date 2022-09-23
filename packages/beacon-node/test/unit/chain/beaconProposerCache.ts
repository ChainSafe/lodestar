import {expect} from "chai";
import {BeaconProposerCache} from "../../../src/chain/beaconProposerCache.js";

const suggestedFeeRecipient = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
describe("BeaconProposerCache", function () {
  let cache: BeaconProposerCache;

  beforeEach(function () {
    // max 2 items
    cache = new BeaconProposerCache({suggestedFeeRecipient});
    cache.add(1, {validatorIndex: "23", feeRecipient: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"});
    cache.add(3, {validatorIndex: "43", feeRecipient: "0xcccccccccccccccccccccccccccccccccccccccc"});
  });

  it("get default", function () {
    expect(cache.get("32")).to.be.equal("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  });

  it("get what has been set", function () {
    expect(cache.get("23")).to.be.equal("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  });

  it("override and get latest", function () {
    cache.add(5, {validatorIndex: "23", feeRecipient: "0xdddddddddddddddddddddddddddddddddddddddd"});
    expect(cache.get("23")).to.be.equal("0xdddddddddddddddddddddddddddddddddddddddd");
  });

  it("prune", function () {
    cache.prune(4);

    // Default for what has been pruned
    expect(cache.get("23")).to.be.equal("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

    // Original for what hasn't been pruned
    expect(cache.get("43")).to.be.equal("0xcccccccccccccccccccccccccccccccccccccccc");
  });
});
