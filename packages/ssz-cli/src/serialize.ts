#!/usr/bin/env node

import yargs from "yargs";
import {types as mainnetTypes} from "@chainsafe/eth2.0-ssz-types/lib/presets/mainnet";
import {types as minimalTypes} from "@chainsafe/eth2.0-ssz-types/lib/presets/minimal";
import {serialize} from "@chainsafe/ssz";

import {readInput, writeOutput} from "./io";
import {inputParsers, outputParsers} from "./parse";

(async function() {
  
  const argv = yargs.options({
    i: {
      alias: "input",
      description: "Input file, will read from stdin if no input specified",
      type: "string",
    },
    "raw-input": {
      description: "Raw input data",
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
      default: "mainnet",
      choices: ["mainnet", "minimal"],
      type: "string",
    },
    t: {
      alias: "type",
      description: "Eth2.0 data type",
      choices: Object.keys(mainnetTypes),
      demand: true,
      type: "string",
    },
  }).argv;
  try {
    // process input
    const input = await readInput(argv.i, argv["raw-input"]);
    // parse input
    const inputParser = "yaml";
    const parsedInput = inputParsers[inputParser].parse(input);
    // process config
    let config;
    if (argv.config === "mainnet") {
      config = mainnetTypes;
    }
    if (argv.config === "minimal") {
      config = minimalTypes;
    }
    // process type
    const type = config[argv.t];
    // perform action
    const output = serialize(parsedInput, type);
    // parse output
    const outputParser = "hex";
    const parsedOutput = outputParsers[outputParser].dump(output);
    // write output
    await writeOutput(parsedOutput, argv.o);
  } catch (e) {
    console.error(e.message);
  }
})();
