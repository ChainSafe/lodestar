import * as fs from "fs";
import yargs from "yargs/yargs";
import { expect } from "chai";
// import { altonaConfig } from "../../../src/cmds/beacon/testnets/altona";
import {testnetName, testnetDir, tmpDir} from "../../constants";
import { account } from "../../../src/cmds/account";
import rimraf from "rimraf";

describe("account cli", function() {

  after(async () => {
    await new Promise(resolve => rimraf(tmpDir, resolve));
    // fs.unlink(tmpGenesisPath, () => {});
  });
  
  // lodestar account wallet create --name primary --passphraseFile primary.pass --rootDir .tmp
  it.only("should init beacon configuration & run beacon node", async function() {
    expect(fs.existsSync(`${tmpDir}/wallets/`)).to.be.false;
    // initialize beacon node configured to talk to testnet
    await new Promise(resolve => yargs().default({
      rootDir: tmpDir,
      name: "primary",
      passphraseFile: "primary.pass",
      // @ts-ignore
    }).command(account).help().parse(["account", "wallet", "create"], resolve));
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(fs.existsSync(`${tmpDir}/wallets/`)).to.be.true;
  });
});