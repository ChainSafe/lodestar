// Must not use `* as yargs`, see https://github.com/yargs/yargs/issues/1131
import yargs, {Argv} from "yargs";
import {hideBin} from "yargs/helpers";
import {registerCommandToYargs} from "@lodestar/utils";
import {cmds} from "./cmds/index.js";
import {globalOptions, rcConfigOption} from "./options/index.js";
import {getVersionData} from "./util/version.js";

/**
 * Check for duplicate flags in raw argv and throw an error if found.
 * This prevents silent "last value wins" behavior for non-array options.
 */
function checkDuplicateFlags(argv: string[]): void {
  const flagCounts = new Map<string, number>();

  for (const arg of argv) {
    // Match flags like --flag, -f, --flag=value
    const match = arg.match(/^(-{1,2}[a-zA-Z][a-zA-Z0-9.-]*)(?:=.*)?$/);
    if (match) {
      const flag = match[1];
      flagCounts.set(flag, (flagCounts.get(flag) ?? 0) + 1);
    }
  }

  const duplicates: string[] = [];
  for (const [flag, count] of flagCounts) {
    if (count > 1) {
      duplicates.push(flag);
    }
  }

  if (duplicates.length > 0) {
    throw new Error(`Duplicate flags are not allowed: ${duplicates.join(", ")}`);
  }
}

const {version} = getVersionData();
const topBanner = `🌟 Lodestar: TypeScript Implementation of the Ethereum Consensus Beacon Chain.
  * Version: ${version}
  * by ChainSafe Systems, 2018-${new Date().getFullYear()}`;
const bottomBanner = `📖 For more information, check the CLI reference:
  * https://chainsafe.github.io/lodestar/reference/cli

✍️ Give feedback and report issues on GitHub:
  * https://github.com/ChainSafe/lodestar`;

export const yarg = yargs((hideBin as (args: string[]) => string[])(process.argv));

/**
 * Common factory for running the CLI and running integration tests
 * The CLI must actually be executed in a different script
 */
export function getLodestarCli(): Argv {
  // Check for duplicate flags before yargs parses them
  // This throws an error instead of silent "last value wins" behavior
  checkDuplicateFlags(process.argv);

  const lodestar = yarg
    .env("LODESTAR")
    .parserConfiguration({
      // As of yargs v16.1.0 dot-notation breaks strictOptions()
      // Manually processing options is typesafe tho more verbose
      "dot-notation": false,
    })
    .options(globalOptions)
    // blank scriptName so that help text doesn't display the cli name before each command
    .scriptName("")
    .demandCommand(1)
    // Control show help behaviour below on .fail()
    .showHelpOnFail(false)
    .usage(topBanner)
    .epilogue(bottomBanner)
    .version(topBanner)
    .alias("h", "help")
    .alias("v", "version")
    .recommendCommands();

  // yargs.command and all ./cmds
  for (const cmd of cmds) {
    registerCommandToYargs(lodestar, cmd);
  }

  // throw an error if we see an unrecognized cmd
  lodestar.recommendCommands().strict();
  lodestar.config(...rcConfigOption);

  return lodestar;
}
