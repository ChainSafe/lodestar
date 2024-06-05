#!/usr/bin/env node

// MUST import first to apply preset from args and set ssz hasher
import "./applyPreset.js";
import {YargsError} from "../utils/errors.js";
import {getLodestarProverCli, yarg} from "./cli.js";
import "source-map-support/register.js";

const prover = getLodestarProverCli();

void prover
  .fail((msg, err) => {
    if (msg) {
      // Show command help message when no command is provided
      if (msg.includes("Not enough non-option arguments")) {
        yarg.showHelp();
        // eslint-disable-next-line no-console
        console.log("\n");
      }
    }

    const errorMessage =
      err !== undefined ? (err instanceof YargsError ? err.message : err.stack) : msg || "Unknown error";

    // eslint-disable-next-line no-console
    console.error(` ✖ ${errorMessage}\n`);
    process.exit(1);
  })

  // Execute CLI
  .parse();
