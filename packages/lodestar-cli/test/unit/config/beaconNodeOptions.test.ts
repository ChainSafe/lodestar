import {expect} from "chai";
import defaultOptions from "@chainsafe/lodestar/lib/node/options";
import {BeaconNodeOptions} from "../../../src/config";
import {bootEnrs as medallaBootEnrs} from "../../../src/testnets/medalla";

describe("config / beaconNodeOptions", () => {
  it("Should return medalla options", () => {
    const beaconNodeOptions = new BeaconNodeOptions({
      testnet: "medalla",
      configFile: "./no/file",
      beaconNodeOptionsCli: {},
    });

    // Asserts only part of the data structure to avoid unnecesary duplicate code
    const optionsPartial = beaconNodeOptions.get();
    expect(optionsPartial?.network?.discv5?.bootEnrs).to.deep.equal(medallaBootEnrs);
  });

  it("Should return added partial options", () => {
    const initialPartialOptions = {eth1: {enabled: true}};
    const editedPartialOptions = {eth1: {enabled: false}};

    const beaconNodeOptions = new BeaconNodeOptions({
      configFile: "./no/file",
      beaconNodeOptionsCli: initialPartialOptions,
    });
    beaconNodeOptions.set(editedPartialOptions);

    const optionsPartial = beaconNodeOptions.get();
    expect(optionsPartial).to.deep.equal(editedPartialOptions);
  });

  it("Should return default options", () => {
    const beaconNodeOptions = new BeaconNodeOptions({
      configFile: "./no/file",
      beaconNodeOptionsCli: {},
    });

    // Assert only part of the data structure as ENR can't be compared directly
    const options = beaconNodeOptions.getWithDefaults();
    expect(options.eth1).to.deep.equal(defaultOptions.eth1);
  });
});
