import {defaultOptions, IBeaconNodeOptions} from "@chainsafe/lodestar";
import {RecursivePartial} from "@chainsafe/lodestar-utils";
import {expect} from "chai";
import fs from "fs";
import path from "path";
import {getBeaconPaths} from "../../../src/cmds/beacon/paths";
import {BeaconNodeOptions, mergeBeaconNodeOptions} from "../../../src/config";
import {enrsToNetworkConfig, getInjectableBootEnrs} from "../../../src/networks";
import {bootEnrs as pyrmontBootEnrs} from "../../../src/networks/pyrmont";
import {testFilesDir} from "../../utils";

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

  it("Should return options with injected custom bootnodes", async () => {
    const expectedBootEnr = "enr:-KG4QOWkRj";
    const rootDir = testFilesDir;
    const bootnodesFile = path.join(testFilesDir, "bootnodesFile.txt");
    fs.writeFileSync(bootnodesFile, expectedBootEnr);
    const beaconPaths = getBeaconPaths({rootDir});
    beaconPaths.bootnodesFile = bootnodesFile;

    const injectableBootEnrs = await getInjectableBootEnrs(beaconPaths.bootnodesFile);

    const beaconNodeOptions = new BeaconNodeOptions({
      network: "pyrmont",
      beaconNodeOptionsCli: injectableBootEnrs,
    });

    // Asserts only part of the data structure to avoid unnecesary duplicate code
    const optionsPartial = beaconNodeOptions.get();
    expect(optionsPartial?.network?.discv5?.bootEnrs).to.deep.equal([expectedBootEnr]);
  });

  it("Should return inline, CLI-provided boot ENR even if bootnodes file is provided", async () => {
    const bootnodesFileContent = "enr:-KG4QOWkRj";
    const expectedBootEnr = "enr:-W4gMj";

    const rootDir = testFilesDir;
    const bootnodesFile = path.join(testFilesDir, "bootnodesFile.txt");
    fs.writeFileSync(bootnodesFile, bootnodesFileContent);
    const beaconPaths = getBeaconPaths({rootDir});
    beaconPaths.bootnodesFile = bootnodesFile;

    const injectableBootEnrs = await getInjectableBootEnrs(beaconPaths.bootnodesFile);
    const beaconNodeOptionsCli = mergeBeaconNodeOptions(injectableBootEnrs, enrsToNetworkConfig([expectedBootEnr]));

    const beaconNodeOptions = new BeaconNodeOptions({
      network: "pyrmont",
      beaconNodeOptionsCli,
    });

    // Asserts only part of the data structure to avoid unnecesary duplicate code
    const optionsPartial = beaconNodeOptions.get();
    expect(optionsPartial?.network?.discv5?.bootEnrs).to.deep.equal([expectedBootEnr]);
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
