import fs from "node:fs";
import {expect} from "vitest";
import {apiTokenFileName} from "../../src/cmds/validator/keymanager/server.js";
import {recursiveLookup} from "../../src/util/index.js";

export function findApiToken(dirpath: string): string {
  const files = recursiveLookup(dirpath);
  const apiTokenFilepaths = files.filter((filepath) => filepath.endsWith(apiTokenFileName));
  switch (apiTokenFilepaths.length) {
    case 0:
      throw Error(`No api token file found in ${dirpath}`);
    case 1:
      return fs.readFileSync(apiTokenFilepaths[0], "utf8").trim();
    default:
      throw Error(`Too many token files found: ${apiTokenFilepaths.join(" ")}`);
  }
}

export function expectDeepEquals<T>(a: T, b: T, message: string): void {
  expect(a).toEqualWithMessage(b, message);
}

/**
 * Similar to `expectDeepEquals` but only checks presence of all elements in array, irrespective of their order.
 */
export function expectDeepEqualsUnordered<T>(a: T[], b: T[], message: string): void {
  expect(a).toEqualWithMessage(expect.arrayContaining(b), message);
  expect(b).toEqualWithMessage(expect.arrayContaining(a), message);
  expect(a).toHaveLength(b.length);
}
