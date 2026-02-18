#!/usr/bin/env node

// MUST import first before any other Lodestar code
import "./setUvThreadPool.js";
import "./applyPreset.js";

import {getLodestarCli, yarg} from "./cli.js";
import {YargsError} from "./util/index.js";
import "source-map-support/register.js";

const lodestar = getLodestarCli();

void lodestar
  .fail((msg, err) => {
    if (msg?.includes("Not enough non-option arguments")) {
      // Show command help message when no command is provided
      yarg.showHelp();
      console.log("\n");
    }

    const errorMessage =
      err !== undefined ? (err instanceof YargsError ? err.message : err.stack) : msg || "Unknown error";

    console.error(` ✖ ${errorMessage}\n`);
    process.exit(1);
  })

  // Execute CLI
  .parse();
