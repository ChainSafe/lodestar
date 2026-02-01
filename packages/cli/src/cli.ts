// Must not use `* as yargs`, see https://github.com/yargs/yargs/issues/1131
import yargs, {Argv} from "yargs";
import {hideBin} from "yargs/helpers";
import {CliCommand, CliCommandOptions, registerCommandToYargs} from "@lodestar/utils";
import {cmds} from "./cmds/index.js";
import {globalOptions, rcConfigOption} from "./options/index.js";
import {getVersionData} from "./util/version.js";

/**
 * Traverses all commands and subcommands to find all options of type "array".
 * This is used to allow duplicate flags for array-like options.
 * Also includes aliases for array options.
 */
// biome-ignore lint/suspicious/noExplicitAny: Need any for generic command types
function getAllArrayOptions(commands: CliCommand<any, any>[], globalOpts: CliCommandOptions<any>): Set<string> {
  const arrayOptions = new Set<string>();

  // biome-ignore lint/suspicious/noExplicitAny: Need any for generic option types
  function processOptions(options: CliCommandOptions<any> | undefined): void {
    if (!options) return;

    for (const key of Object.keys(options)) {
      const opt = options[key];
      if (opt.type === "array") {
        arrayOptions.add(key);
        if (opt.alias) {
          const aliases = Array.isArray(opt.alias) ? opt.alias : [opt.alias];
          for (const alias of aliases) {
            arrayOptions.add(String(alias));
          }
        }
      }
    }
  }

  // biome-ignore lint/suspicious/noExplicitAny: Need any for generic command types
  function traverseCommands(cmds: CliCommand<any, any>[]): void {
    for (const cmd of cmds) {
      processOptions(cmd.options);
      if (cmd.subcommands) {
        traverseCommands(cmd.subcommands);
      }
    }
  }

  traverseCommands(commands);
  processOptions(globalOpts);

  return arrayOptions;
}

// Build set of all array options at module load time
const ARRAY_OPTIONS = getAllArrayOptions(cmds, globalOptions);

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
  const lodestar = yarg
    .env("LODESTAR")
    .parserConfiguration({
      // As of yargs v16.1.0 dot-notation breaks strictOptions()
      // Manually processing options is typesafe tho more verbose
      "dot-notation": false,
    })
    .check((argv) => {
      // Detect duplicate flags: if a non-array option has an array value,
      // it means the flag was passed multiple times
      const duplicates: string[] = [];
      for (const [key, value] of Object.entries(argv)) {
        // Skip internal yargs keys and array options (which legitimately accept multiple values)
        if (key === "_" || key === "$0" || ARRAY_OPTIONS.has(key)) continue;
        if (Array.isArray(value)) {
          duplicates.push(`--${key}`);
        }
      }
      if (duplicates.length > 0) {
        throw new Error(`Duplicate flags are not allowed: ${duplicates.join(", ")}`);
      }
      return true;
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
