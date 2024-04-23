#!/usr/bin/env node

/**
 * MUST import first!!
 * - applies preset
 * - sets ssz hasher
 * - sets libuv thread pool size
 */
import "./preInitialization.js";
/**
 * Everything else must be after!!
 */
import {YargsError} from "./util/index.js";
import {getLodestarCli, yarg} from "./cli.js";
import "source-map-support/register.js";

const lodestar = getLodestarCli();

void lodestar
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
