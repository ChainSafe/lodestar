import {describe, it} from "mocha";
import {generateState} from "../../../utils/state";
import {BeaconStateCache} from "../../../../src/cache/items/state";
import {config} from "@chainsafe/eth2.0-config/src/presets/mainnet";
import {equals} from "@chainsafe/ssz";
import {expect} from "chai";

describe("state cache", function () {

  it("should store and get latest state", function () {
    const state = generateState();
    const cache = new BeaconStateCache(config);
    cache.updateLatest(state);
    const cachedState = cache.getLatest();
    expect(equals(state, cachedState, config.types.BeaconState)).to.be.true;
  });
});