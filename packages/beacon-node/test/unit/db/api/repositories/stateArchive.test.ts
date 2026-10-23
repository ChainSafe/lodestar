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

  it("should find state bytes by root after putBinaryWithRoot", async () => {
    const stateRoot = Buffer.alloc(32, 1);
    const stateBytes = new Uint8Array([1, 2, 3]);

    await stateArchive.putBinaryWithRoot(32, stateBytes, stateRoot);

    expect(await stateArchive.getBinaryByRoot(stateRoot)).toEqual(Buffer.from(stateBytes));
    expect(await stateArchive.dumpRootIndexEntries()).toHaveLength(1);
  });

  it("should not index a state stored with putBinary", async () => {
    await stateArchive.putBinary(32, new Uint8Array([1]));

    expect(await stateArchive.getBinary(32)).not.toBeNull();
    expect(await stateArchive.dumpRootIndexEntries()).toHaveLength(0);
  });
});
