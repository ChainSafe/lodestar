import * as fs from "fs";
import yargs from "yargs/yargs";
import {expect} from "chai";

import {init} from "../../../src/cmds/init";
import {beacon} from "../../../src/cmds/beacon";
import {altonaConfig} from "../../../src/testnets/altona";
import {testnetName} from "../../constants";
import {tmpDir} from "../../constants";

describe("beacon cli", function() {
  this.timeout("10 min");

  const rootDir = tmpDir;

  it("should init beacon configuration", async function() {
    await new Promise(resolve => yargs().default({
      rootDir,
      preset: "mainnet",
    }).command(init).parse(["init"], resolve));
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(fs.existsSync(rootDir)).to.be.true;
    expect(fs.existsSync(`${rootDir}/beacon.config.json`)).to.be.true;
  });

  it("should init beacon configuration with --testnet option", async function() {
    await new Promise(resolve => yargs()
      .default({
        rootDir,
        preset: "mainnet",
      })
      .command(init).help().parse(["init", "--testnet", testnetName], resolve));
    await new Promise(resolve => setTimeout(resolve, 3000));
    expect(fs.existsSync(rootDir)).to.be.true;
    const beaconConfigPath = `${rootDir}/beacon.config.json`;
    expect(fs.existsSync(beaconConfigPath)).to.be.true;
    
    const beaconConfig = JSON.parse(fs.readFileSync(beaconConfigPath, "utf8"));
    let altonaConfigCopy = JSON.parse(JSON.stringify(altonaConfig));
    altonaConfigCopy = {
      ...altonaConfigCopy,
      beaconDir: rootDir,
      configFile: beaconConfigPath,
      dbDir: `${rootDir}/chain-db`,
      enrFile: `${rootDir}/enr.json`,
      eth1: { ...altonaConfigCopy.eth1, enabled: false },
      genesisStateFile: `${rootDir}/genesis.ssz`,
      peerIdFile: `${rootDir}/peer-id.json`
    }
    expect(beaconConfig).to.deep.equal(altonaConfigCopy);
  });

  // succeeds, but need to find a way to stop the process
  it.skip("should init beacon configuration & run beacon node", async function() {
    await new Promise(resolve => yargs()
      .default({
        rootDir,
        preset: "mainnet",
      })
      .command(init).help().parse(["init", "--testnet", testnetName], resolve));
    await new Promise(resolve => setTimeout(resolve, 1500));
    expect(fs.existsSync(rootDir)).to.be.true;
    const beaconConfigPath = `${rootDir}/beacon.config.json`;
    expect(fs.existsSync(beaconConfigPath)).to.be.true;

    await new Promise(resolve => yargs().default({
      rootDir,
      preset: "mainnet",
      // @ts-ignore
    }).command(beacon).help().parse(["beacon"], resolve));
    await new Promise(resolve => setTimeout(resolve, 500));
  });
});
