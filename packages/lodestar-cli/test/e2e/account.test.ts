import yargs from "yargs/yargs";
import {expect} from "chai";
import {stub} from "sinon";

import {rootDir, passphraseFile} from "./constants";
import {account} from "../../src/cmds/account";
import {ValidatorDirManager} from "../../src/validatorDir";
import {getAccountPaths} from "../../src/cmds/account/paths";
import {init} from "../../src/cmds/init";
import {TestnetName, fetchBootnodes} from "../../src/testnets";
import {spadinaConfig} from "../../src/testnets/spadina";
import {existsSync, readFileSync, readdirSync} from "fs";
import lockFile from "lockfile";
import {registerCommandToYargs} from "../../src/util";

describe("account cli", function () {
  this.timeout("10 min");

  const spy = stub(console, "log");
  const lockSpy = stub(lockFile, "lockSync");

  const testnetName = "spadina";
  const initDefaults = {
    rootDir,
    preset: "mainnet",
    testnet: testnetName as TestnetName,
    paramsFile: "config.yaml",
    params: {
      DEPOSIT_CHAIN_ID: 5,
      DEPOSIT_NETWORK_ID: 5,
    },
  };

  const walletsDir = `${rootDir}/wallets/`;
  const walletName = "primary";

  const accountDefaults = {
    ...initDefaults,
    name: walletName,
    passphraseFile,
  };

  it("should init beacon configuration with --testnet option", async function () {
    const lodestar = yargs().default(initDefaults).help();
    registerCommandToYargs(lodestar, init);

    await new Promise((resolve) => lodestar.parse(["init"], resolve));
    await new Promise((resolve) => setTimeout(resolve, 6000));
    expect(existsSync(rootDir)).to.be.true;
    const beaconConfigPath = `${rootDir}/beacon.config.json`;
    expect(existsSync(beaconConfigPath)).to.be.true;

    const beaconConfig = JSON.parse(readFileSync(beaconConfigPath, "utf8"));
    let templateConfigCopy = JSON.parse(JSON.stringify(spadinaConfig));
    templateConfigCopy = {
      ...templateConfigCopy,
      beaconDir: rootDir,
      configFile: beaconConfigPath,
      dbDir: `${rootDir}/chain-db`,
      enrFile: `${rootDir}/enr.json`,
      eth1: {...templateConfigCopy.eth1, enabled: false},
      genesisStateFile: `${rootDir}/genesis.ssz`,
      peerIdFile: `${rootDir}/peer-id.json`,
      peerStoreDir: `${rootDir}/peerstore`,
      network: {
        ...templateConfigCopy.network,
        discv5: {
          ...templateConfigCopy.network.discv5,
          bootEnrs: await fetchBootnodes(testnetName),
        },
      },
    };
    expect(beaconConfig).to.deep.equal(templateConfigCopy);
  });

  it("should create a wallet", async function () {
    expect(existsSync(rootDir)).to.be.true;

    const lodestar = yargs().default(accountDefaults).help();
    registerCommandToYargs(lodestar, account);

    await new Promise((resolve) => lodestar.parse(["account", "wallet", "create"], resolve));
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(existsSync(walletsDir)).to.be.true;
    const wallets = readdirSync(walletsDir);
    expect(wallets.length > 0).to.be.true;
  });

  it("should list existing wallets", async function () {
    const lodestar = yargs().default(accountDefaults).help();
    registerCommandToYargs(lodestar, account);
    await new Promise((resolve) => lodestar.parse(["account", "wallet", "list"], resolve));
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(spy.calledWith(walletName)).to.be.true;
  });

  it("should create new validator", async function () {
    const lodestar = yargs().default(accountDefaults).help();
    registerCommandToYargs(lodestar, account);
    const wallets = readdirSync(walletsDir);
    expect(wallets.length > 0).to.be.true;
    await new Promise((resolve) => lodestar.parse(["account", "validator", "create"], resolve));
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(lockSpy.calledOnce);
    expect(existsSync(`${rootDir}/keystores`)).to.be.true;
    expect(readdirSync(`${rootDir}/keystores`).length > 0).to.be.true;
  });

  it("should list validators", async function () {
    const lodestar = yargs().default(accountDefaults).help();
    registerCommandToYargs(lodestar, account);
    await new Promise((resolve) => lodestar.parse(["account", "validator", "list"], resolve));
    await new Promise((resolve) => setTimeout(resolve, 500));
    const accountPaths = getAccountPaths({rootDir});
    const validatorDirManager = new ValidatorDirManager(accountPaths);
    const validatorPubKeys = validatorDirManager.iterDir();
    expect(spy.calledWith(validatorPubKeys.join("\n"))).to.be.true;
  });

  it("should make a deposit to validator registration contract", async function () {
    expect(existsSync(`${rootDir}/keystores`)).to.be.true;
    const validatorId = readdirSync(`${rootDir}/keystores`)[0];
    expect(validatorId).to.not.be.undefined;
    const lodestar = yargs()
      .default({
        ...accountDefaults,
        rpcUrl: "http://127.0.0.1:8545",
        validator: validatorId,
      })
      .help();
    registerCommandToYargs(lodestar, account);
    expect(existsSync(`${rootDir}/keystores/${validatorId}/.lock`)).to.be.false;
    await new Promise((resolve) => lodestar.parse(["account", "validator", "deposit"], resolve));
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(existsSync(`${rootDir}/keystores/${validatorId}/eth1-deposit-tx-hash.txt`)).to.be.true;
  });
});
