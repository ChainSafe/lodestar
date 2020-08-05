import * as fs from "fs";
import yargs from "yargs/yargs";
import { expect } from "chai";
import * as sinon from "sinon";

import {tmpDir, testnetName, testnetDir} from "../../constants";
import { account } from "../../../src/cmds/account";
import { ValidatorDirManager } from "../../../src/validatorDir";
import { getAccountPaths } from "../../../src/cmds/account/paths";
import { init } from "../../../src/cmds/init";

describe("account cli", function() {
  const spy = sinon.stub(console, 'log');

  const rootDir = tmpDir;
  const walletsDir = `${rootDir}/wallets/`;
  const walletName = "primary";
  
  // lodestar account wallet create --name primary --passphraseFile primary.pass --rootDir .tmp
  it("should create a wallet", async function() {

    await new Promise(resolve => yargs().default({
      rootDir,
      preset: "mainnet",
    }).command(init).parse(["init"], resolve));
    await new Promise(resolve => setTimeout(resolve, 500));

    expect(fs.existsSync(rootDir)).to.be.true;
    await new Promise(resolve => yargs().default({
      rootDir,
      name: walletName,
      passphraseFile: "primary.pass",
      testnet: testnetName,
      preset: "mainnet",
      // @ts-ignore
    }).command(account as any).help().parse(["account", "wallet", "create"], resolve));
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(fs.existsSync(walletsDir)).to.be.true;
    const wallets = fs.readdirSync(walletsDir);
    expect(wallets.length > 0).to.be.true;
  });

  // lodestar account wallet list --rootDir .tmp
  it("should list existing wallets", async function() {
    await new Promise(resolve => yargs().default({
      rootDir,
      // @ts-ignore
    }).command(account).help().parse(["account", "wallet", "list"], resolve));
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(spy.calledWith(walletName)).to.be.true;
  });

  // lodestar account validator create --name primary --passphraseFile primary.pass --rootDir .tmp
  it("should create new validator", async function() {
    await new Promise(resolve => yargs().default({
      name: walletName,
      passphraseFile: "primary.pass",
      rootDir,
      preset: "mainnet",
      testnet: testnetName,
      // @ts-ignore
    }).command(account).help().parse(["account", "validator", "create"], resolve));
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(spy.calledWith(sinon.match.string)).to.be.true;
  });

  // lodestar account validator list --rootDir .tmp
  it("should list validators", async function() {
    await new Promise(resolve => yargs().default({
      rootDir,
      // @ts-ignore
    }).command(account).help().parse(["account", "validator", "list"], resolve));
    await new Promise(resolve => setTimeout(resolve, 500));
    const accountPaths = getAccountPaths({rootDir});
    const validatorDirManager = new ValidatorDirManager(accountPaths);
    const validatorPubKeys = validatorDirManager.iterDir();
    expect(spy.calledWith(validatorPubKeys.join("\n"))).to.be.true;
  });

  // @TODO: still need to figure out how to deposit for this test.  might look into ganache-core as per wemeetagain's tip
  // lodestar account validator deposit --validator <validatorID> --rootDir .dir
  it("should make a deposit to validator registration contract", async function() {
    const validatorId = fs.readdirSync(`${rootDir}/keystores`)[0];
    await new Promise(resolve => yargs().default({
      rootDir,
      rpcUrl: "http://127.0.0.1:8545",
      testnet: testnetName,
      preset: "mainnet",
      // validator: validatorId,
      // @ts-ignore
    }).command(account).help().parse(["account", "validator", "deposit"], resolve));
    await new Promise(resolve => setTimeout(resolve, 500));
  });
});