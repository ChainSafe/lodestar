import {Argv} from "yargs";

/**
 * yargs.parse() attempts to exit if called from a yargs build step in certain cases (help and version)
 * This calls yargs.parse() in a way that doesn't exit
 */
export function parseArgs<T>(yargs: Argv<T>): T {
  // parse args without exiting
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  return yargs.parse(process.argv, true as unknown as object, function() {});
}
