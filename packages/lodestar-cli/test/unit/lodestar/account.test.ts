import * as fs from "fs";
import yargs from "yargs/yargs";
import { expect } from "chai";
import * as sinon from "sinon";

import {tmpDir} from "../../constants";
import { account } from "../../../src/cmds/account";
import { ValidatorDirManager } from "../../../src/validatorDir";
import { getAccountPaths } from "../../../src/cmds/account/paths";

describe("account cli", function() {
  const spy = sinon.stub(console, 'log');

  const walletsDir = `${tmpDir}/wallets/`;
  const walletName = "primary";
  
  // lodestar account wallet create --name primary --passphraseFile primary.pass --rootDir .tmp
  it("should create a wallet", async function() {
    expect(fs.existsSync(walletsDir)).to.be.false;
    await new Promise(resolve => yargs().default({
      rootDir: tmpDir,
      name: walletName,
      passphraseFile: "primary.pass",
      // @ts-ignore
    }).command(account).help().parse(["account", "wallet", "create"], resolve));
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(fs.existsSync(walletsDir)).to.be.true;
    const wallets = fs.readdirSync(walletsDir);
    expect(wallets.length > 0).to.be.true;
  });

  // lodestar account wallet list --rootDir .tmp
  it("should list existing wallets", async function() {
    await new Promise(resolve => yargs().default({
      rootDir: tmpDir,
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
      rootDir: tmpDir,
      preset: "mainnet",
      // @ts-ignore
    }).command(account).help().parse(["account", "validator", "create"], resolve));
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(spy.called).to.be.true;
  });

  // lodestar account validator list --rootDir .tmp
  it("should list validators", async function() {
    await new Promise(resolve => yargs().default({
      rootDir: tmpDir,
      // @ts-ignore
    }).command(account).help().parse(["account", "validator", "list"], resolve));
    await new Promise(resolve => setTimeout(resolve, 500));
    const accountPaths = getAccountPaths({rootDir: tmpDir});
    const validatorDirManager = new ValidatorDirManager(accountPaths);
    const validatorPubKeys = validatorDirManager.iterDir();
    expect(spy.calledWith(validatorPubKeys.join("\n"))).to.be.true;
  });

  // @TODO: still need to figure out how to deposit for this test.  might look into ganache-core as per wemeetagain's tip
  // lodestar account validator deposit --validator <validatorID> --rootDir .tmpDir
  it("should make a deposit to validator registration contract", async function() {
    await new Promise(resolve => yargs().default({
      rootDir: tmpDir,
      // @ts-ignore
    }).command(account).help().parse(["account", "validator", "deposit"], resolve));
    await new Promise(resolve => setTimeout(resolve, 500));
  });
});