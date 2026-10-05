import {mkdtemp, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {LevelDbController} from "@lodestar/db/controller/level";
import {testLogger} from "@lodestar/logger/test-utils";
import {NUMBER_OF_COLUMNS} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BeaconDb} from "../../../src/db/beacon.js";
import {blobSidecarsWrapperSsz} from "../../../src/db/repositories/blobSidecars.js";

describe("BeaconDb.pruneHotDb", () => {
  const config = createChainForkConfig({FULU_FORK_EPOCH: 0});
  const logger = testLogger();
  let tmpDir: string;
  let db: BeaconDb;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "lodestar-prune-hot-db-"));
    const controller = await LevelDbController.create({name: path.join(tmpDir, "leveldb")}, {logger});
    db = new BeaconDb(config, controller, {dataColumnDir: path.join(tmpDir, "data_columns"), logger});
    await db.init();
  });

  afterEach(async () => {
    await db.close();
    await rm(tmpDir, {recursive: true, force: true});
  });

  it.each([0, 1, 8])("prunes hot sidecars for %i roots while preserving other data", async (rootCount) => {
    const columns = Array.from({length: NUMBER_OF_COLUMNS}, (_, index) => ({
      ...ssz.fulu.DataColumnSidecar.defaultValue(),
      index,
    }));
    for (let i = 0; i < rootCount; i++) {
      const root = Buffer.alloc(32, i);
      await db.dataColumnSidecar.putMany(root, columns);
      await db.blobSidecars.put(root, {blockRoot: root, slot: i, blobSidecars: []});
    }

    const block = ssz.fulu.SignedBeaconBlock.defaultValue();
    const root = ssz.fulu.BeaconBlock.hashTreeRoot(block.message);
    const slot = block.message.slot;
    const blobSidecars = {blockRoot: root, slot, blobSidecars: [ssz.deneb.BlobSidecar.defaultValue()]};
    const column = columns[0];
    await db.block.put(root, block);
    await db.blobSidecarsArchive.put(slot, blobSidecars);
    await db.dataColumnSidecarArchive.put(slot, column);
    await db.dataColumns.putManyBinary({slot, blockRoot: toRootHex(root)}, [
      {index: column.index, data: ssz.fulu.DataColumnSidecar.serialize(column)},
    ]);
    expect(await db.dataColumnSidecar.keys()).toHaveLength(rootCount * NUMBER_OF_COLUMNS);

    await db.pruneHotDb();

    expect((await db.dataColumnSidecar.keys()).length).toBe(0);
    expect((await db.blobSidecars.keys()).length).toBe(0);
    expect(await db.block.getBinary(root)).toEqual(ssz.fulu.SignedBeaconBlock.serialize(block));
    expect(await db.blobSidecarsArchive.getBinary(slot)).toEqual(blobSidecarsWrapperSsz.serialize(blobSidecars));
    expect(await db.dataColumnSidecarArchive.getBinary(slot, column.index)).toEqual(
      ssz.fulu.DataColumnSidecar.serialize(column)
    );
    expect(await db.dataColumns.getAll({slot, blockRoot: toRootHex(root)})).toEqual([column]);
  });
});
