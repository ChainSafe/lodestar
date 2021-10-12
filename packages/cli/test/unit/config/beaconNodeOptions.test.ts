import {expect} from "chai";
import {defaultOptions, IBeaconNodeOptions} from "@chainsafe/lodestar";
import {BeaconNodeOptions, mergeBeaconNodeOptions} from "../../../src/config";
import {bootEnrs as pyrmontBootEnrs} from "../../../src/networks/pyrmont";
import {RecursivePartial} from "@chainsafe/lodestar-utils";

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
    const initialPartialOptions = {eth1: {enabled: true}};
    const editedPartialOptions = {eth1: {enabled: false}};

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

describe("mergeBeaconNodeOptions", () => {
  const enrsToNetworkConfig = (enrs: string[]): RecursivePartial<IBeaconNodeOptions> => {
    return {
      network: {
        discv5: {
          bootEnrs: enrs,
        },
      },
    };
  };

  const testCases: {name: string; networkEnrs: string[]; cliEnrs: string[]; resultEnrs: string[]}[] = [
    {name: "normal case", networkEnrs: ["enr-1", "enr-2", "enr-3"], cliEnrs: ["new-enr"], resultEnrs: ["new-enr"]},
    // TODO: investigate arrayMerge has no effect?
    // {
    //   name: "should not override",
    //   networkEnrs: ["enr-1", "enr-2", "enr-3"],
    //   cliEnrs: [],
    //   resultEnrs: ["enr-1", "enr-2", "enr-3"],
    // },
  ];

  for (const {name, networkEnrs, cliEnrs, resultEnrs} of testCases) {
    it(name, () => {
      const networkConfig = enrsToNetworkConfig(networkEnrs);
      const cliConfig = enrsToNetworkConfig(cliEnrs);
      expect(mergeBeaconNodeOptions(networkConfig, cliConfig)).to.be.deep.equal(enrsToNetworkConfig(resultEnrs));
    });
  }
});
