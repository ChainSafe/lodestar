import {Argv} from "yargs";
import {parseArgs} from "./parseArgs";
import {IYargsOptionsMap} from "./yargs";

/**
 * Generate options based on the currently built yargs
 */
export function mergeOptions<T, U>(
  yargs: Argv<T>,
  optionsFn: (args: T) => IYargsOptionsMap
): Argv<U> {
  const args = parseArgs(yargs);
  return yargs.options(optionsFn(args)) as Argv<U>;
}
