#!/usr/bin/env node
/* eslint-disable import/no-extraneous-dependencies */
import {loadOptions} from "mocha/lib/cli/cli.js";
import yargs from "yargs/yargs";
import mochaPackage from "mocha/package.json" assert {type: "json"};
import runCommand from "./mocha_run.mjs";

const argv = process.argv.slice(2);
const args = loadOptions(argv);

const yargsOptions = {
  "combine-arrays": true,
  "short-option-groups": false,
  "dot-notation": false,
  "strip-aliased": true,
};

yargs()
  .scriptName("mocha")
  .command(runCommand)
  .updateStrings({
    "Positionals:": "Positional Arguments",
    "Options:": "Other Options",
    "Commands:": "Commands",
  })
  .fail((msg, err, yargs) => {
    yargs.showHelp();
    process.exitCode = 1;
  })
  .help("help", "Show usage information & exit")
  .alias("help", "h")
  .version("version", "Show version number & exit", mochaPackage.version)
  .alias("version", "V")
  .wrap(process.stdout.columns ? Math.min(process.stdout.columns, 80) : 80)
  .parserConfiguration(yargsOptions)
  .config(args)
  .parse(args._)
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
