import {Options} from "yargs";
import {ICLIOptions} from "../cmds/beacon/cmds/run/options/chain";

function firstAlias(option: Options): string {
  if (Array.isArray(option.alias)) {
    return option.alias[0];
  }
  return option.alias as string;
}

function popAlias(option: Options): void {
  if (Array.isArray(option.alias)) {
    option.alias.shift();
  } else {
    delete option.alias;
  }
}

/**
 * An option's first alias, if it exists is set as the 'canonical' one
 */
export function canonicalOptions(options: Record<string, ICLIOptions>): Record<string, ICLIOptions> {
  const cOptions: Record<string, ICLIOptions> = {};
  for (const [alias, option] of Object.entries(options)) {
    if (!option.alias) {
      cOptions[alias] = option;
    } else if (option.canonicalAlias) {
      cOptions[option.canonicalAlias] = option;
      delete option.canonicalAlias;
    } else {
      const canonicalAlias = firstAlias(option);
      if (alias !== canonicalAlias) {
        popAlias(option);
      }
      cOptions[canonicalAlias] = option;
    }
  }
  return cOptions;
}
