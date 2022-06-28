import fs from "node:fs";
import {expect} from "chai";
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
  expect(a).deep.equals(b, message);
}

export type DoneCb = (err?: Error) => void;

/**
 * Extends Mocha it() to allow BOTH:
 * - Resolve / reject callback promise to end test
 * - Use done() to end test early
 */
export function itDone(itName: string, cb: (this: Mocha.Context, done: DoneCb) => Promise<void>): void {
  it(itName, function () {
    return new Promise<void>((resolve, reject) => {
      function done(err?: Error): void {
        if (err) reject(err);
        else resolve();
      }
      cb.bind(this)(done).then(resolve, reject);
    });
  });
}

export type AfterEachCallback = () => Promise<void> | void;

export function getAfterEachCallbacks(): AfterEachCallback[] {
  const afterEachCallbacks: (() => Promise<void> | void)[] = [];

  afterEach(async () => {
    const errs: Error[] = [];
    for (const cb of afterEachCallbacks) {
      try {
        await cb();
      } catch (e) {
        errs.push(e as Error);
      }
    }
    afterEachCallbacks.length = 0; // Reset array
    if (errs.length > 0) {
      throw errs[0];
    }
  });

  return afterEachCallbacks;
}
