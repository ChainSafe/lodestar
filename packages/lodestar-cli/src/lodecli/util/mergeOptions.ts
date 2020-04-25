import {Argv, Options} from "yargs";
import {canonicalOptions} from "./canonicalOptions";

/**
 * Generate options based on the current yargs
 */
export function mergeOptions<T, U>(yargs: Argv<T>, optionsFns: Record<string, ((args: T) => Options) | Options>): Argv<U> {
  // parse args without exiting
  const args = yargs.parse(process.argv, true as unknown as object, function() {});
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
