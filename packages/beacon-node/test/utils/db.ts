import fs from "node:fs";
import {ChainForkConfig} from "@lodestar/config";
import {FilterOptions} from "@lodestar/db";
import {LevelDbController} from "@lodestar/db/controller/level";
import {testLogger} from "@lodestar/logger/test-utils";
import {BeaconDb} from "../../src/index.js";

export const TEMP_DB_LOCATION = ".tmpdb";
const TEMP_DATA_COLUMN_LOCATION = `${TEMP_DB_LOCATION}-data-columns`;

export async function startTmpBeaconDb(config: ChainForkConfig): Promise<BeaconDb> {
  fs.rmSync(TEMP_DB_LOCATION, {recursive: true, force: true});
  fs.rmSync(TEMP_DATA_COLUMN_LOCATION, {recursive: true, force: true});

  const logger = testLogger();
  const db = new BeaconDb(config, await LevelDbController.create({name: TEMP_DB_LOCATION}, {logger}), {
    dataColumnDir: TEMP_DATA_COLUMN_LOCATION,
    logger,
  });
  await db.init();
  return db;
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
