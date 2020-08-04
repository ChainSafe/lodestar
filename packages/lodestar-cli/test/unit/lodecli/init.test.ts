import * as fs from "fs";
import yargs from "yargs/yargs";
import {expect} from "chai";
import rimraf from "rimraf";

import {init} from "../../../src/cmds/init";

describe("beacon cli", function() {
  this.timeout("10 min");

  const tmpDir = ".tmp";

  after(async () => {
    await new Promise(resolve => rimraf(tmpDir, resolve));
  });

  it("should init beacon configuration", async function() {
    // initialize beacon node configured to talk to testnet
    await new Promise(resolve => yargs().default({
      rootDir: tmpDir,
      preset: "mainnet",
      // @ts-ignore
    }).command(init).parse(["init"], resolve));
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(fs.existsSync(tmpDir)).to.be.true;
    expect(fs.existsSync(`${tmpDir}/beacon.config.json`)).to.be.true;
  });
});
