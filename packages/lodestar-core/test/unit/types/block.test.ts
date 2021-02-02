import {config} from "@chainsafe/lodestar-config/minimal";
import {expect} from "chai";
import {generateSignedBlock} from "../../../../lodestar/test/utils/block";
import {
  getBeaconBlockSSZType,
  getSignedBeaconBlockSSZType,
  getSignedBeaconBlockSSZTypeBySlot,
} from "../../../src/types/block";

describe("getSignedBeaconBlockSSZTypeBySlot", function () {
  beforeEach(function () {
    config.params.lightclient.LIGHTCLIENT_PATCH_FORK_SLOT = 10;
  });

  it("should get phase0 ssz type", function () {
    const result = getSignedBeaconBlockSSZTypeBySlot(config, 0);
    expect(result).to.be.deep.equal(config.types.SignedBeaconBlock);
  });

  it("should get lightclient ssz type", function () {
    const result = getSignedBeaconBlockSSZTypeBySlot(config, 11);
    expect(result).to.be.deep.equal(config.types.lightclient.SignedBeaconBlock);
  });
});

describe("getSignedBeaconBlockSSZType", function () {
  beforeEach(function () {
    config.params.lightclient.LIGHTCLIENT_PATCH_FORK_SLOT = 10;
  });

  it("should get phase0 ssz type", function () {
    const result = getSignedBeaconBlockSSZType(config, generateSignedBlock({message: {slot: 0}}));
    expect(result).to.be.deep.equal(config.types.SignedBeaconBlock);
  });

  it("should get lightclient ssz type", function () {
    const result = getSignedBeaconBlockSSZType(config, generateSignedBlock({message: {slot: 11}}));
    expect(result).to.be.deep.equal(config.types.lightclient.SignedBeaconBlock);
  });
});

describe("getBeaconBlockSSZType", function () {
  beforeEach(function () {
    config.params.lightclient.LIGHTCLIENT_PATCH_FORK_SLOT = 10;
  });

  it("should get phase0 ssz type", function () {
    const result = getBeaconBlockSSZType(config, generateSignedBlock({message: {slot: 0}}).message);
    expect(result).to.be.deep.equal(config.types.BeaconBlock);
  });

  it("should get lightclient ssz type", function () {
    const result = getBeaconBlockSSZType(config, generateSignedBlock({message: {slot: 11}}).message);
    expect(result).to.be.deep.equal(config.types.lightclient.BeaconBlock);
  });
});
