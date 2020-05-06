import {Argv, Options} from "yargs";
import {canonicalOptions} from "./canonicalOptions";
import {parseArgs} from "./parseArgs";

/**
 * Generate options based on the currently built yargs
 */
export function mergeOptions<T, U>(
  yargs: Argv<T>,
  optionsFns: Record<string, ((args: T) => Options) | Options>
): Argv<U> {
  const args = parseArgs(yargs);
  const options: Record<string, Options> = {};
  for (const [optionName, optionOrFn] of Object.entries(optionsFns)) {
    if (typeof optionOrFn === "function") {
      options[optionName] = optionOrFn(args);
    } else {
      options[optionName] = optionOrFn;
    }
  }
  return yargs.options(canonicalOptions(options)) as Argv<U>;
}
