import fs from "fs";
import {expect} from "chai";
import {IBeaconNodeOptions} from "@chainsafe/lodestar";
import {ReturnType as InitReturnType} from "../../../src/cmds/init";
import {getBeaconPaths} from "../../../src/cmds/beacon/paths";
import {depositContractDeployBlock} from "../../../src/networks/pyrmont";
import {testFilesDir} from "../../utils";
import {getLodestarCliTestRunner} from "../commandRunner";

describe("cmds / init", function () {
  const lodestar = getLodestarCliTestRunner();

  const rootDir = testFilesDir;
  const networkName = "pyrmont";
  const beaconPaths = getBeaconPaths({rootDir});

  it("should init beacon configuration with --network option", async function () {
    await lodestar<InitReturnType>([
      //
      "init",
      `--network ${networkName}`,
      `--rootDir ${rootDir}`,
    ]);

    expect(fs.existsSync(beaconPaths.configFile), `Must write config file to ${beaconPaths.configFile}`).to.be.true;
    const beaconConfig: IBeaconNodeOptions = JSON.parse(
      fs.readFileSync(beaconPaths.configFile, "utf8")
    ) as IBeaconNodeOptions;

    expect(beaconConfig.eth1.depositContractDeployBlock).to.equal(
      depositContractDeployBlock,
      "Wrong depositContractDeployBlock for --network pyrmont setting"
    );
  });
});
