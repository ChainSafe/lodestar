#!/usr/bin/env node

// eslint-disable-next-line no-restricted-imports, import/no-extraneous-dependencies
import {hasher} from "@chainsafe/persistent-merkle-tree/lib/hasher/as-sha256.js";
// eslint-disable-next-line no-restricted-imports, import/no-extraneous-dependencies
import {setHasher} from "@chainsafe/persistent-merkle-tree/lib/hasher/index.js";
import "source-map-support/register.js";

// without setting this first, persistent-merkle-tree will use noble instead
setHasher(hasher);
// MUST import second to apply preset from args
await import("./applyPreset.js");
const {getLodestarProverCli, yarg} = await import("./cli.js");
const {YargsError} = await import("../utils/errors.js");
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
