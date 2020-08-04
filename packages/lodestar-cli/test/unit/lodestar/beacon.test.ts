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

  it("should init beacon configuration", async function() {
    // initialize beacon node configured to talk to testnet
    await new Promise(resolve => yargs().default({
      rootDir: tmpDir,
      preset: "mainnet",
    }).command(init).parse(["init"], resolve));
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(fs.existsSync(tmpDir)).to.be.true;
    expect(fs.existsSync(`${tmpDir}/beacon.config.json`)).to.be.true;
  });

  it("should init beacon configuration with --testnet option", async function() {
    // initialize beacon node configured to talk to testnet
    await new Promise(resolve => yargs()
      .default({
        rootDir: tmpDir,
        preset: "mainnet",
      })
      .command(init).help().parse(["init", "--testnet", testnetName], resolve));
    await new Promise(resolve => setTimeout(resolve, 1500));
    expect(fs.existsSync(tmpDir)).to.be.true;
    const beaconConfigPath = `${tmpDir}/beacon.config.json`;
    expect(fs.existsSync(beaconConfigPath)).to.be.true;
    
    const beaconConfig = JSON.parse(fs.readFileSync(beaconConfigPath, "utf8"));
    let altonaConfigCopy = JSON.parse(JSON.stringify(altonaConfig));
    altonaConfigCopy = {
      ...altonaConfigCopy,
      beaconDir: tmpDir,
      configFile: beaconConfigPath,
      dbDir: `${tmpDir}/chain-db`,
      enrFile: `${tmpDir}/enr.json`,
      eth1: { ...altonaConfigCopy.eth1, enabled: false },
      genesisStateFile: `${tmpDir}/genesis.ssz`,
      peerIdFile: `${tmpDir}/peer-id.json`
    }
    expect(beaconConfig).to.deep.equal(altonaConfigCopy);
  });

  // fails (documented via #1251)
  it.skip("should init beacon configuration with --templateConfigFile option and copy over all options from altona config to beacon config", async function() {
    fs.writeFile("tmp.json", JSON.stringify(altonaConfig, null, 2), () => {});
    // initialize beacon node configured to talk to testnet
    await new Promise(resolve => yargs().default({
      rootDir: tmpDir,
      preset: "mainnet",
    }).command(init).help().parse(["init", "--templateConfigFile", "tmp.json"], resolve));
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(fs.existsSync(tmpDir)).to.be.true;
    const beaconConfigPath = `${tmpDir}/beacon.config.json`;
    expect(fs.existsSync(beaconConfigPath)).to.be.true;
    
    const beaconConfig = JSON.parse(fs.readFileSync(beaconConfigPath, "utf8"));
    expect(beaconConfig).to.deep.equal(altonaConfig);
  });

  // succeeds, but need to find a way to stop the process
  it.skip("should init beacon configuration & run beacon node", async function() {
    // initialize beacon node configured to talk to testnet
    await new Promise(resolve => yargs()
      .default({
        rootDir: tmpDir,
        preset: "mainnet",
      })
      .command(init).help().parse(["init", "--testnet", testnetName], resolve));
    await new Promise(resolve => setTimeout(resolve, 1500));
    expect(fs.existsSync(tmpDir)).to.be.true;
    const beaconConfigPath = `${tmpDir}/beacon.config.json`;
    expect(fs.existsSync(beaconConfigPath)).to.be.true;

    // initialize beacon node configured to talk to testnet
    await new Promise(resolve => yargs().default({
      rootDir: tmpDir,
      preset: "mainnet",
      // @ts-ignore
    }).command(beacon).help().parse(["beacon"], resolve));
    await new Promise(resolve => setTimeout(resolve, 500));
  });
});
