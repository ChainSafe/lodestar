import {Options} from "yargs";

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
export function canonicalOptions(options: Record<string, Options>): Record<string, Options> {
  const cOptions: Record<string, Options> = {};
  for (const [alias, option] of Object.entries(options)) {
    if (!option.alias) {
      cOptions[alias] = option;
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
