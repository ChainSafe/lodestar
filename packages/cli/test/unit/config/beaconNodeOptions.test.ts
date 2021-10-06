import {expect} from "chai";
import {RecursivePartial} from "@chainsafe/lodestar-utils";
import {defaultOptions, IBeaconNodeOptions} from "@chainsafe/lodestar";
import {BeaconNodeOptions} from "../../../src/config";
import {bootEnrs as pyrmontBootEnrs} from "../../../src/networks/pyrmont";

describe("config / beaconNodeOptions", () => {
  it("Should return pyrmont options", () => {
    const beaconNodeOptions = new BeaconNodeOptions({
      network: "pyrmont",
      beaconNodeOptionsCli: {},
    });

    // Asserts only part of the data structure to avoid unnecesary duplicate code
    const optionsPartial = beaconNodeOptions.get();
    expect(optionsPartial?.network?.discv5?.bootEnrs).to.deep.equal(pyrmontBootEnrs);
  });

  it("Should return added partial options", () => {
    const initialPartialOptions = {eth1: {mode: "rpcClient"}} as RecursivePartial<IBeaconNodeOptions>;
    const editedPartialOptions = {eth1: {mode: "disabled"}} as RecursivePartial<IBeaconNodeOptions>;

    const beaconNodeOptions = new BeaconNodeOptions({
      beaconNodeOptionsCli: initialPartialOptions,
    });
    beaconNodeOptions.set(editedPartialOptions);

    const optionsPartial = beaconNodeOptions.get();
    expect(optionsPartial).to.deep.equal(editedPartialOptions);
  });

  it("Should return default options", () => {
    const beaconNodeOptions = new BeaconNodeOptions({
      beaconNodeOptionsCli: {},
    });

    // Assert only part of the data structure as ENR can't be compared directly
    const options = beaconNodeOptions.getWithDefaults();
    expect(options.eth1).to.deep.equal(defaultOptions.eth1);
  });
});
