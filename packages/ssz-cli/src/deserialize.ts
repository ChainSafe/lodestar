#!/usr/bin/env node

import yargs from "yargs";
import {deserialize} from "@chainsafe/ssz";

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
    // process input
    const input = await readInput(argv.i);
    // parse input
    const inputParser = "hex";
    const parsedInput = outputParsers[inputParser].parse(input);
    // process config
    const config = presets[argv.config];
    // process type
    const type = config[argv.t];
    // perform action
    const output = deserialize(parsedInput, type);
    // parse output
    const outputParser = "yaml";
    const parsedOutput = inputParsers[outputParser].dump(output);
    // write output
    await writeOutput(parsedOutput, argv.o);
  } catch (e) {
    console.error(e.message);
  }
})();
