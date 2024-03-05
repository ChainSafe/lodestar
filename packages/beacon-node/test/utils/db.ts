import childProcess from "node:child_process";
import {FilterOptions, LevelDbController} from "@lodestar/db";
import {ChainForkConfig} from "@lodestar/config";
import {BeaconDb} from "../../src/index.js";
import {testLogger} from "./logger.js";

export const TEMP_DB_LOCATION = ".tmpdb";

export async function startTmpBeaconDb(config: ChainForkConfig): Promise<BeaconDb> {
  // Clean-up db first
  childProcess.execSync(`rm -rf ${TEMP_DB_LOCATION}`);

  return new BeaconDb(config, await LevelDbController.create({name: TEMP_DB_LOCATION}, {logger: testLogger()}));
}

/**
 * Helper to filter an array with DB FilterOptions options
 */
export function filterBy<T>(items: T[], options: FilterOptions<number>, getter: (item: T) => number): T[] {
  return items.filter(
    (item) =>
      (options.gt === undefined || getter(item) > options.gt) &&
      (options.gte === undefined || getter(item) >= options.gte) &&
      (options.lt === undefined || getter(item) < options.lt) &&
      (options.lte === undefined || getter(item) <= options.lte)
  );
}
