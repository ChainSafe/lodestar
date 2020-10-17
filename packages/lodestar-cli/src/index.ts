#!/usr/bin/env node

// Must not use `* as yargs`, see https://github.com/yargs/yargs/issues/1131
import yargs from "yargs";
import {cmds} from "./cmds";
import {globalOptions} from "./options";
import {YargsError, registerCommandToYargs} from "./util";
import "source-map-support/register";

const topBanner = "🌟 Lodestar: Ethereum 2.0 TypeScript Implementation of the Beacon Chain";
const bottomBanner = "For more information, check the CLI reference https://chainsafe.github.io/lodestar/reference/cli";

const lodestar = yargs
  .env("LODESTAR")
  .options(globalOptions)
  // blank scriptName so that help text doesn't display the cli name before each command
  .scriptName("")
  .demandCommand(1)
  // Control show help behaviour below on .fail()
  .showHelpOnFail(false)
  .usage(topBanner)
  .epilogue(bottomBanner)
  .alias("h", "help")
  .alias("v", "version")
  .recommendCommands()
  .help()
  .wrap(yargs.terminalWidth())
  .fail((msg, err) => {
    if (msg) {
      // Show command help message when no command is provided
      if (msg.includes("Not enough non-option arguments")) {
        yargs.showHelp();
        // eslint-disable-next-line no-console
        console.log("\n");
      }
    }

    const errorMessage = err ? (err instanceof YargsError ? err.message : err.stack) : msg || "Unknown error";

    // eslint-disable-next-line no-console
    console.error(` ✖ ${errorMessage}\n`);
    process.exit(1);
  });

// yargs.command and all ./cmds
for (const cmd of cmds) {
  registerCommandToYargs(lodestar, cmd);
}

lodestar.recommendCommands().strict();

lodestar.parse();
