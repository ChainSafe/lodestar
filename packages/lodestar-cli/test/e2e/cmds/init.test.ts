import fs from "fs";
import {expect} from "chai";
import {IBeaconNodeOptions} from "@chainsafe/lodestar";
import {ReturnType as InitReturnType} from "../../../src/cmds/init";
import {getBeaconPaths} from "../../../src/cmds/beacon/paths";
import {depositContractDeployBlock} from "../../../src/testnets/medalla";
import {testFilesDir} from "../../utils";
import {getLodestarCliTestRunner} from "../commandRunner";

describe("cmds / init", function () {
  const lodestar = getLodestarCliTestRunner();

  const rootDir = testFilesDir;
  const testnetName = "medalla";
  const beaconPaths = getBeaconPaths({rootDir});

  it("should init beacon configuration with --testnet option", async function () {
    await lodestar<InitReturnType>([
      //
      "init",
      `--testnet ${testnetName}`,
      `--rootDir ${rootDir}`,
    ]);

    expect(fs.existsSync(beaconPaths.configFile), `Must write config file to ${beaconPaths.configFile}`).to.be.true;
    const beaconConfig: IBeaconNodeOptions = JSON.parse(fs.readFileSync(beaconPaths.configFile, "utf8"));

    expect(beaconConfig.eth1.depositContractDeployBlock).to.equal(
      depositContractDeployBlock,
      "Wrong depositContractDeployBlock for --testnet medalla setting"
    );
  });
});
