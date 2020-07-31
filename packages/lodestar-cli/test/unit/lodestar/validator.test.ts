import * as fs from "fs";
import yargs from "yargs/yargs";
import {tmpDir} from "../../constants";
import { validator } from "../../../src/cmds/validator";
import { account } from "../../../src/cmds/account";
import { expect } from "chai";

describe("validator cli", function() {
  it("should run validator command", async function() {

    // create a wallet
    expect(fs.existsSync(`${tmpDir}/wallets/`)).to.be.false;
    await new Promise(resolve => yargs().default({
      rootDir: tmpDir,
      name: "primary",
      passphraseFile: "primary.pass",
      // @ts-ignore
    }).command(account).help().parse(["account", "wallet", "create"], resolve));
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(fs.existsSync(`${tmpDir}/wallets/`)).to.be.true;

    
    // crate a validator
    await new Promise(resolve => yargs().default({
      name: "primary",
      passphraseFile: "primary.pass",
      rootDir: tmpDir,
      preset: "mainnet", // @TODO: do we really need this?
      // @ts-ignore
    }).command(account).help().parse(["account", "validator", "create"], resolve));
    await new Promise(resolve => setTimeout(resolve, 500));


    // run validator command
    await new Promise(resolve => yargs().default({
      rootDir: tmpDir,
      preset: "mainnet", // @TODO: do we really need this?
      // @ts-ignore
    }).command(validator).help().parse(["validator"], resolve));
    await new Promise(resolve => setTimeout(resolve, 500));
  });
});