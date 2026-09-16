import {rimraf} from "rimraf";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {config} from "@lodestar/config/default";
import {LevelDbController} from "@lodestar/db/controller/level";
import {testLogger} from "@lodestar/logger/test-utils";
import {StateArchiveRepository} from "../../../../../src/db/repositories/index.js";

describe("state archive repository", () => {
  const testDir = "./.tmp_state_archive_unit_test";
  let stateArchive: StateArchiveRepository;
  let db: LevelDbController;

  beforeEach(async () => {
    db = await LevelDbController.create({name: testDir}, {logger: testLogger()});
    stateArchive = new StateArchiveRepository(config, db);
  });
  afterEach(async () => {
    await db.close();
    rimraf.sync(testDir);
  });

  it("should delete root index entries with the states", async () => {
    const states = [0, 32, 64].map((slot) => ({
      slot,
      root: Buffer.alloc(32, slot + 1),
      bytes: new Uint8Array([slot]),
    }));
    for (const {slot, root, bytes} of states) {
      await stateArchive.put(slot, {serialize: () => bytes, hashTreeRoot: () => root});
    }

    await stateArchive.batchDelete([0, 32]);

    expect(await stateArchive.getBinaryByRoot(states[0].root)).toBeNull();
    expect(await stateArchive.getBinaryByRoot(states[1].root)).toBeNull();
    expect(await stateArchive.getBinaryByRoot(states[2].root)).not.toBeNull();
    expect((await stateArchive.dumpRootIndexEntries()).map((entry) => entry.slot)).toEqual([64]);
  });
});
