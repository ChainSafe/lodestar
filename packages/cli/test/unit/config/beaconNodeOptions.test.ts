import {expect} from "chai";
import {BeaconNodeOptions} from "../../../src/config/index.js";
import {bootEnrs as goerliBootEnrs} from "../../../src/networks/goerli.js";

describe("config / beaconNodeOptions", () => {
  it("Should return goerli options", () => {
    const beaconNodeOptions = new BeaconNodeOptions({});

    // Asserts only part of the data structure to avoid unnecesary duplicate code
    const optionsPartial = beaconNodeOptions.get();
    expect(optionsPartial?.network?.discv5?.bootEnrs).to.deep.equal(goerliBootEnrs);
  });

  it("Should return added partial options", () => {
    const initialPartialOptions = {eth1: {enabled: true}};
    const editedPartialOptions = {eth1: {enabled: false}};

    const beaconNodeOptions = new BeaconNodeOptions(initialPartialOptions);
    beaconNodeOptions.set(editedPartialOptions);

    const optionsPartial = beaconNodeOptions.get();
    expect(optionsPartial).to.deep.equal(editedPartialOptions);
  });
});
