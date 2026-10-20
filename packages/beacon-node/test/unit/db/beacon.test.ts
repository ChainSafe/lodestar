import {mkdtemp, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {encodeKey} from "@lodestar/db";
import {LevelDbController} from "@lodestar/db/controller/level";
import type {IForkChoice} from "@lodestar/fork-choice";
import {testLogger} from "@lodestar/logger/test-utils";
import {NUMBER_OF_COLUMNS} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {archiveBlocks} from "../../../src/chain/archiveStore/utils/archiveBlocks.js";
import {BeaconDb} from "../../../src/db/beacon.js";
import {Bucket} from "../../../src/db/buckets.js";
import {blobSidecarsWrapperSsz} from "../../../src/db/repositories/blobSidecars.js";
import {generateProtoBlock} from "../../utils/typeGenerator.js";

describe("BeaconDb startup", () => {
  const config = createChainForkConfig({FULU_FORK_EPOCH: 0});
  const logger = testLogger();
  let tmpDir: string;
  let db: BeaconDb;
  let controller: LevelDbController;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "lodestar-prune-hot-db-"));
    controller = await LevelDbController.create({name: path.join(tmpDir, "leveldb")}, {logger});
    db = new BeaconDb(config, controller, {dataColumnDir: path.join(tmpDir, "data_columns"), logger});
    await db.init();
  });

  afterEach(async () => {
    await db.close();
    await rm(tmpDir, {recursive: true, force: true});
  });

  it.each([0, 1, 8])("prunes hot blobs for %i roots without scanning legacy columns", async (rootCount) => {
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

    const keysStream = vi.spyOn(controller, "keysStream");
    const compact = vi.spyOn(controller, "compactRange");

    await db.pruneHotDb();

    expect(keysStream).not.toHaveBeenCalledWith({
      gte: encodeKey(Bucket.allForks_dataColumnSidecars, Buffer.alloc(0)),
      lt: encodeKey(Bucket.allForks_dataColumnSidecars + 1, Buffer.alloc(0)),
    });
    expect(compact).not.toHaveBeenCalled();
    expect(await db.dataColumnSidecar.keys()).toHaveLength(rootCount * NUMBER_OF_COLUMNS);
    expect((await db.blobSidecars.keys()).length).toBe(0);
    expect(await db.block.getBinary(root)).toEqual(Buffer.from(ssz.fulu.SignedBeaconBlock.serialize(block)));
    expect(await db.blobSidecarsArchive.getBinary(slot)).toEqual(
      Buffer.from(blobSidecarsWrapperSsz.serialize(blobSidecars))
    );
    expect(await db.dataColumnSidecarArchive.getBinary(slot, column.index)).toEqual(
      Buffer.from(ssz.fulu.DataColumnSidecar.serialize(column))
    );
    expect(await db.dataColumns.getAll({slot, blockRoot: toRootHex(root)})).toEqual([column]);
  });

  it.each([false, true])("initializes without scanning legacy columns (populated: %s)", async (populated) => {
    const slot = 10;
    const column = ssz.fulu.DataColumnSidecar.defaultValue();
    if (populated) {
      await db.dataColumnSidecarArchive.put(slot, column);
    }
    await db.close();
    controller = await LevelDbController.create({name: path.join(tmpDir, "leveldb")}, {logger});
    db = new BeaconDb(config, controller, {dataColumnDir: path.join(tmpDir, "data_columns"), logger});
    const keysStream = vi.spyOn(controller, "keysStream");
    const archiveKeys = vi.spyOn(db.dataColumnSidecarArchive, "keys");

    await db.init();

    expect(archiveKeys).not.toHaveBeenCalled();
    expect(keysStream).not.toHaveBeenCalled();
    expect(await db.dataColumnSidecarArchive.getBinary(slot, column.index)).toEqual(
      populated ? Buffer.from(ssz.fulu.DataColumnSidecar.serialize(column)) : null
    );
  });

  it("keeps canonical flat columns serveable after block archiving", async () => {
    const block = ssz.fulu.SignedBeaconBlock.defaultValue();
    const slot = block.message.slot;
    const root = ssz.fulu.BeaconBlock.hashTreeRoot(block.message);
    const blockRoot = toRootHex(root);
    const key = {slot, blockRoot};
    const column = ssz.fulu.DataColumnSidecar.defaultValue();
    const columnBytes = ssz.fulu.DataColumnSidecar.serialize(column);
    await db.block.put(root, block);
    await db.dataColumns.putManyBinary(key, [{index: column.index, data: columnBytes}]);
    const forkChoice = {
      getAllAncestorAndNonAncestorBlocksDefaultStatus: () => ({
        ancestors: [generateProtoBlock({slot, blockRoot})],
        nonAncestors: [],
      }),
    } as unknown as IForkChoice;

    await archiveBlocks(
      config,
      db,
      forkChoice,
      undefined,
      logger,
      {epoch: 0, root, rootHex: blockRoot},
      0,
      null,
      false
    );

    expect(await db.block.getBinary(root)).toBeNull();
    expect(await db.blockArchive.getBinary(slot)).toEqual(Buffer.from(ssz.fulu.SignedBeaconBlock.serialize(block)));
    expect(await db.dataColumns.getManyBinary(key, [column.index])).toEqual([columnBytes]);
  });
});
