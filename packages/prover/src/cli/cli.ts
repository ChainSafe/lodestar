// eslint-disable-next-line no-restricted-imports, import/no-extraneous-dependencies
import {hasher} from "@chainsafe/persistent-merkle-tree/lib/hasher/as-sha256.js";
// eslint-disable-next-line no-restricted-imports, import/no-extraneous-dependencies
import {setHasher} from "@chainsafe/persistent-merkle-tree/lib/hasher/index.js";
// Must not use `* as yargs`, see https://github.com/yargs/yargs/issues/1131
import yargs from "yargs";
import {hideBin} from "yargs/helpers";
import {registerCommandToYargs} from "../utils/command.js";
import {getVersionData} from "../utils/version.js";
import {cmds} from "./cmds/index.js";
import {globalOptions} from "./options.js";

// without setting this first, persistent-merkle-tree will use noble instead
setHasher(hasher);

const {version} = getVersionData();
const topBanner = `🌟 Lodestar Prover Proxy: Ethereum RPC proxy for RPC responses, verified against the trusted block hashes.
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
export function getLodestarProverCli(): yargs.Argv {
  const prover = yarg
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
    registerCommandToYargs(prover, cmd);
  }

  // throw an error if we see an unrecognized cmd
  prover.recommendCommands().strict();

  return prover;
}
