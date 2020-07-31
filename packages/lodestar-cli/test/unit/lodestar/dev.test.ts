import * as fs from "fs";
import yargs from "yargs/yargs";
import {tmpDir} from "../../constants";
import { dev } from "../../../src/cmds/dev";
import { expect } from "chai";

describe.only("dev cli", function() {
  it("should run dev command", async function() {
    await new Promise(resolve => yargs().default({
      rootDir: tmpDir,
      preset: "mainnet", // @TODO: do we really need this?
      // @ts-ignore
    }).command(dev).help().parse(["dev"], resolve));
    await new Promise(resolve => setTimeout(resolve, 500));
  });
});