import {Argv, Options} from "yargs";

export function mergeOptions<T, U>(yargs: Argv<T>, optionsFns: Record<string, (args: T) => Options>): Argv<U> {
  const args = yargs.argv;
  const options: Record<string, Options> = {};
  for (const [optionName, optionFn] of Object.entries(optionsFns)) {
    options[optionName] = optionFn(args);
  }
  return yargs.options(options) as Argv<U>;
}
