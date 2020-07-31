import * as fs from "fs";
import yargs from "yargs/yargs";
import { expect } from "chai";
import * as sinon from "sinon";
import { assert } from "console";

import {tmpDir} from "../../constants";
import { account } from "../../../src/cmds/account";

describe("account cli", function() {
  const spy = sinon.stub(console, 'log');
  
  // lodestar account wallet create --name primary --passphraseFile primary.pass --rootDir .tmp
  it("should create a wallet", async function() {
    expect(fs.existsSync(`${tmpDir}/wallets/`)).to.be.false;
    await new Promise(resolve => yargs().default({
      rootDir: tmpDir,
      name: "primary",
      passphraseFile: "primary.pass",
      // @ts-ignore
    }).command(account).help().parse(["account", "wallet", "create"], resolve));
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(fs.existsSync(`${tmpDir}/wallets/`)).to.be.true;
  });

  // lodestar account wallet list --rootDir .tmp
  it("should list existing wallets", async function() {
  await new Promise(resolve => yargs().default({
      rootDir: tmpDir,
      // @ts-ignore
    }).command(account).help().parse(["account", "wallet", "list"], resolve));
    await new Promise(resolve => setTimeout(resolve, 500));
    assert(spy.called);
  });

  // lodestar account validator create --name primary --passphraseFile primary.pass --rootDir .tmp
  it("should create new validator", async function() {
    await new Promise(resolve => yargs().default({
      name: "primary",
      passphraseFile: "primary.pass",
      rootDir: tmpDir,
      preset: "mainnet", // @TODO: do we really need this?
      // @ts-ignore
    }).command(account).help().parse(["account", "validator", "create"], resolve));
    await new Promise(resolve => setTimeout(resolve, 500));
    assert(spy.called);
  });

  // lodestar account validator list --rootDir .tmp
  it("should list validators", async function() {
    await new Promise(resolve => yargs().default({
      rootDir: tmpDir,
      // @ts-ignore
    }).command(account).help().parse(["account", "validator", "list"], resolve));
    await new Promise(resolve => setTimeout(resolve, 500));
    assert(spy.called);
  });

  // @TODO: lodestar account validator deposit --validator <validatorID> --rootDir .tmpDir
  it("should make a deposit to validator registration contract", async function() {
    await new Promise(resolve => yargs().default({
      rootDir: tmpDir,
      // @ts-ignore
    }).command(account).help().parse(["account", "validator", "deposit"], resolve));
    await new Promise(resolve => setTimeout(resolve, 500));
  });

});