import {mkdtemp, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {LevelDbController} from "@lodestar/db/controller/level";
import {testLogger} from "@lodestar/logger/test-utils";

/** Open a LevelDB database in a fresh temp dir, `close()` also removes the dir */
export async function startTmpDb(): Promise<{db: LevelDbController; close: () => Promise<void>}> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "lodestar-builder-test-db-"));
  const db = await LevelDbController.create({name: tmpDir}, {logger: testLogger()});
  return {
    db,
    close: async () => {
      await db.close();
      await rm(tmpDir, {recursive: true, force: true});
    },
  };
}
