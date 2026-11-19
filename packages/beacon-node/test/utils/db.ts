import fs from "node:fs";
import {mkdtemp, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {ChainForkConfig} from "@lodestar/config";
import {FilterOptions} from "@lodestar/db";
import {LevelDbController} from "@lodestar/db/controller/level";
import {testLogger} from "@lodestar/logger/test-utils";
import {BeaconDb} from "../../src/db/index.js";

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
 * Like {@link startTmpBeaconDb} but in a fresh temp dir per call, so test files that vitest runs in
 * parallel don't share `.tmpdb`. `close()` also removes the dir.
 */
export async function startIsolatedTmpBeaconDb(
  config: ChainForkConfig,
  prefix = "lodestar-test-db-"
): Promise<{db: BeaconDb; close: () => Promise<void>}> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), prefix));
  const logger = testLogger();
  const db = new BeaconDb(config, await LevelDbController.create({name: path.join(tmpDir, "leveldb")}, {logger}), {
    dataColumnDir: path.join(tmpDir, "data_columns"),
    logger,
  });
  return {
    db,
    close: async () => {
      await db.close();
      await rm(tmpDir, {recursive: true, force: true});
    },
  };
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
