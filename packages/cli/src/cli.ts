// Must not use `* as yargs`, see https://github.com/yargs/yargs/issues/1131
import yargs from "yargs";
// @ts-expect-error no type
import {hideBin} from "yargs/helpers";
import {cmds} from "./cmds/index.js";
import {globalOptions, rcConfigOption} from "./options/index.js";
import {registerCommandToYargs} from "./util/index.js";
import {getVersionData} from "./util/version.js";

const {version} = getVersionData();
const topBanner = `🌟 Lodestar: TypeScript Implementation of the Ethereum Consensus Beacon Chain.
  * Version: ${version}
  * by ChainSafe Systems, 2018-2022`;
const bottomBanner = `📖 For more information, check the CLI reference:
  * https://chainsafe.github.io/lodestar/reference/cli

✍️ Give feedback and report issues on GitHub:
  * https://github.com/ChainSafe/lodestar`;

export const yarg = yargs((hideBin as (args: string[]) => string[])(process.argv));

/**
 * Common factory for running the CLI and running integration tests
 * The CLI must actually be executed in a different script
 */
export function getLodestarCli(): yargs.Argv {
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
