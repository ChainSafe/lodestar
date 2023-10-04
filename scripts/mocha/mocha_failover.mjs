#!/usr/bin/env node
/* eslint-disable import/no-extraneous-dependencies */

import {spawn} from "node:child_process";
import os from "node:os";
import url from "node:url";
import path from "node:path";
import {loadOptions} from "mocha/lib/cli/cli.js";
import unparse from "yargs-unparser";

const dirName = url.fileURLToPath(new URL(".", import.meta.url));
const mochaPath = path.join(dirName, "mocha_failover_cli.mjs");

process.stdout.write("====================================================\n");
process.stdout.write("%%%%%%% ITS NOT MOCHA BINARY - ITS A WRAPPER %%%%%%%\n");
process.stdout.write("====================================================\n");

const argv = process.argv.slice(2);
const mochaArgs = loadOptions(argv);

const nodeArgv = mochaArgs["node-option"] && mochaArgs["node-option"].map((v) => "--" + v);

delete mochaArgs["node-option"];

const args = [].concat(nodeArgv, mochaPath, unparse(mochaArgs));

const proc = spawn(process.execPath, args, {
  stdio: "inherit",
});

proc.on("exit", (code, signal) => {
  process.on("exit", () => {
    if (signal) {
      process.kill(process.pid, signal);
    } else {
      process.exit(code);
    }
  });
});

// terminate children.
process.on("SIGINT", () => {
  proc.kill("SIGINT");
  if (!args.parallel || args.jobs < 2) {
    // win32 does not support SIGTERM, so use next best thing.
    if (os.platform() === "win32") {
      proc.kill("SIGKILL");
    } else {
      proc.kill("SIGTERM");
    }
  }
});
