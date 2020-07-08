// Must not use `* as yargs`, see https://github.com/yargs/yargs/issues/1131
import yargs from "yargs";

import {dev} from "./cmds/dev";
import {beacon} from "./cmds/beacon";
import {validator} from "./cmds/validator";
import {account} from "./cmds/account";
import {globalOptions} from "./options";
import {YargsError} from "./util";

const topBanner = "🌟 Lodestar: Ethereum 2.0 TypeScript Implementation of the Beacon Chain";
const bottomBanner = "for more information, checks the docs https://chainsafe.github.io/lodestar";

yargs
  .env("LODESTAR")
  .options(globalOptions)
  .command(dev)
  .command(beacon)
  .command(validator)
  .command(account)
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

    const errorMessage = err
      ? err instanceof YargsError
        ? err.message
        : err.stack
      : msg || "Unknown error";
    
    // eslint-disable-next-line no-console
    console.error(` ✖ ${errorMessage}\n`);
    process.exit(1);
  })
  .parse();


