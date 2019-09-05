#!/usr/bin/env node

import yargs from "yargs";
import {hashTreeRoot} from "@chainsafe/ssz";

import {readInput, writeOutput} from "./io";
import {inputParsers, outputParsers} from "./parse";
import {presetNames, presets} from "./types";

(async function() {
  
  const argv = yargs.options({
    i: {
      alias: "input",
      description: "Input file, will read from stdin if no input specified",
      type: "string",
    },
    o: {
      alias: "output",
      description: "Output file, will write to stdout if not specified",
      type: "string",
    },
    c: {
      alias: "config",
      description: "Chain configuration for ssz encoding",
      default: presetNames[0],
      choices: presetNames,
      type: "string",
    },
    t: {
      alias: "type",
      description: "Eth2.0 data type",
      choices: Object.keys(presets[presetNames[0]]),
      demand: true,
      type: "string",
    },
  }).argv;
  try {
    // process config
    const config = presets[argv.config];
    // process type
    const type = config[argv.t];
    // process input
    let input = await readInput(argv.i);
    // parse input
    const inputParser = "yaml";
    const parsedInput = inputParsers[inputParser].parse(input, type);
    // perform action
    const output = hashTreeRoot(parsedInput, type);
    // parse output
    const outputParser = "hex";
    const parsedOutput = outputParsers[outputParser].dump(output);
    // write output
    await writeOutput(parsedOutput, argv.o);
  } catch (e) {
    console.error(e.message);
  }
})();
