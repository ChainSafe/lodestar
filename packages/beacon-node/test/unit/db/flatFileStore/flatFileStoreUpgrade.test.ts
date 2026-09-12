import {mkdtemp, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {PeerId} from "@libp2p/interface";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {LevelDbController} from "@lodestar/db/controller/level";
import {PayloadStatus} from "@lodestar/fork-choice";
import {testLogger} from "@lodestar/logger/test-utils";
import {NUMBER_OF_COLUMNS, SLOTS_PER_EPOCH, SLOTS_PER_HISTORICAL_ROOT} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {fromAsync, toRootHex} from "@lodestar/utils";
import {BeaconChain} from "../../../../src/chain/chain.js";
import type {IBeaconChain} from "../../../../src/chain/interface.js";
import {BeaconDb} from "../../../../src/db/beacon.js";
import {onDataColumnSidecarsByRange} from "../../../../src/network/reqresp/handlers/dataColumnSidecarsByRange.js";

describe.each(["fulu", "gloas"] as const)("flat-file upgrade range serving (%s)", (fork) => {
  const config = createChainForkConfig({FULU_FORK_EPOCH: 0, GLOAS_FORK_EPOCH: fork === "gloas" ? 0 : Infinity});
  const logger = testLogger();
  const peerId = {toString: () => "test-peer"} as PeerId;
  const headSlot = SLOTS_PER_HISTORICAL_ROOT + 100;
  let tmpDir: string;
  let controller: LevelDbController;
  let db: BeaconDb;

  async function openDb(): Promise<void> {
    controller = await LevelDbController.create({name: path.join(tmpDir, "leveldb")}, {logger});
    db = new BeaconDb(config, controller, {dataColumnDir: path.join(tmpDir, "data_columns"), logger});
  }

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "lodestar-column-upgrade-"));
    await openDb();
  });

  afterEach(async () => {
    await db.close();
    await rm(tmpDir, {recursive: true, force: true});
  });

  async function writeColumns(slot: number, storage: "legacy" | "flat") {
    const types = config.getForkTypes(slot);
    const block = types.SignedBeaconBlock.defaultValue();
    block.message.slot = slot;
    const root = types.BeaconBlock.hashTreeRoot(block.message);
    const columns = [0, 1].map((index) => {
      if (fork === "gloas") {
        const column = ssz.gloas.DataColumnSidecar.defaultValue();
        Object.assign(column, {slot, index, beaconBlockRoot: root});
        return {index, data: ssz.gloas.DataColumnSidecar.serialize(column)};
      }
      const column = ssz.fulu.DataColumnSidecar.defaultValue();
      column.index = index;
      column.signedBlockHeader.message.slot = slot;
      column.signedBlockHeader.message.bodyRoot = types.BeaconBlockBody.hashTreeRoot(block.message.body);
      return {index, data: ssz.fulu.DataColumnSidecar.serialize(column)};
    });
    if (storage === "legacy") {
      // Pre-upgrade archived blocks have no slot-to-root index entry.
      await controller.put(db.blockArchive.encodeKey(slot), types.SignedBeaconBlock.serialize(block));
      await db.dataColumnSidecarArchive.putManyBinary(
        slot,
        columns.map(({index, data}) => ({key: index, value: data}))
      );
    } else {
      await db.blockArchive.put(slot, block);
      await db.dataColumns.putManyBinary({slot, blockRoot: toRootHex(root)}, columns);
    }
    if (fork === "gloas") {
      const envelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
      envelope.message.beaconBlockRoot = root;
      envelope.message.payload.slotNumber = slot;
      await db.executionPayloadEnvelopeArchive.put(slot, envelope);
    }
    return {block, columns: columns.map(({data}) => data)};
  }

  function makeChain(): IBeaconChain {
    const fallbackChain = {
      config,
      db,
      seenBlockInputCache: {get: () => undefined},
      seenPayloadEnvelopeInputCache: {get: () => undefined},
    } as unknown as BeaconChain;
    return {
      config,
      clock: {currentEpoch: Math.floor(headSlot / SLOTS_PER_EPOCH)},
      getHeadState: () => ({slot: headSlot}),
      forkChoice: {
        getFinalizedBlock: () => ({slot: headSlot - SLOTS_PER_EPOCH}),
        getHead: () => ({blockRoot: "0x" + "00".repeat(32), payloadStatus: PayloadStatus.FULL}),
        getAllAncestorBlocks: () => [],
      },
      custodyConfig: {custodyColumns: [0, 1], custodyColumnsIndex: new Uint8Array(NUMBER_OF_COLUMNS).fill(1)},
      earliestAvailableSlot: 0,
      seenPayloadEnvelopeInputCache: {hasPayload: () => false},
      logger,
      metrics: null,
      getCanonicalBlockAtSlot: vi.fn().mockRejectedValue(new Error("range serving must not load blocks")),
      getSerializedDataColumnSidecars: (slot: number, root: string, indices: number[]) =>
        BeaconChain.prototype.getSerializedDataColumnSidecars.call(fallbackChain, slot, root, indices),
    } as unknown as IBeaconChain;
  }

  async function requestRange(startSlot: number, count: number, chain = makeChain()) {
    const responses = await fromAsync(
      onDataColumnSidecarsByRange({startSlot, count, columns: [0, 1]}, chain, db, peerId, "test-client")
    );
    return responses.map(({data}) => new Uint8Array(data));
  }

  it("should serve existing unindexed archived columns after restart alongside indexed flat files", async () => {
    const first = await writeColumns(10, "legacy");
    const flat = await writeColumns(11, "flat");
    const last = await writeColumns(12, "legacy");
    await db.close();
    await openDb();
    const archiveKeys = vi.spyOn(db.dataColumnSidecarArchive, "keys");
    await db.init();
    const archiveRead = vi.spyOn(db.dataColumnSidecarArchive, "getManyBinary");
    const blockRead = vi.spyOn(db.blockArchive, "getBinary");

    expect(await db.blockArchive.getRootBySlot(10)).toBeNull();
    expect(await db.blockArchive.getRootBySlot(12)).toBeNull();
    expect(await requestRange(9, 5)).toEqual([...first.columns, ...flat.columns, ...last.columns]);
    expect(archiveKeys).toHaveBeenCalledExactlyOnceWith({reverse: true, limit: 1});
    expect(archiveRead.mock.calls.map(([slot]) => slot)).toEqual(fork === "gloas" ? [10, 12] : [9, 10, 12]);
    expect(blockRead).not.toHaveBeenCalled();
    expect(await db.blockArchive.getRootBySlot(10)).toBeNull();
    expect(await db.blockArchive.getRootBySlot(12)).toBeNull();
  });

  it("should avoid archive reads when startup finds no legacy columns", async () => {
    await db.init();
    const archiveRead = vi.spyOn(db.dataColumnSidecarArchive, "getManyBinary");
    const blockRead = vi.spyOn(db.blockArchive, "getBinary");
    expect(await requestRange(0, 2)).toEqual([]);
    expect(archiveRead).not.toHaveBeenCalled();
    expect(blockRead).not.toHaveBeenCalled();
  });

  it("should not try legacy storage above the startup cutoff", async () => {
    await writeColumns(10, "legacy");
    await db.init();
    const archiveRead = vi.spyOn(db.dataColumnSidecarArchive, "getManyBinary");
    const envelopeRead = vi.spyOn(db.executionPayloadEnvelopeArchive, "getBinary");
    expect(await requestRange(11, 2)).toEqual([]);
    expect(archiveRead).not.toHaveBeenCalled();
    expect(envelopeRead).not.toHaveBeenCalled();
  });

  it("should serve legacy columns archived later through the normal root index", async () => {
    await db.init();
    const {block, columns} = await writeColumns(20, "legacy");
    await db.blockArchive.put(20, block);
    expect(await requestRange(20, 1)).toEqual(columns);
  });

  it.each(["fork choice", "head state"])("should preserve skipped slots known to %s", async (source) => {
    await writeColumns(12, "legacy");
    await db.init();
    const chain = makeChain();
    if (source === "fork choice") {
      vi.spyOn(chain.forkChoice, "getAllAncestorBlocks").mockReturnValue([
        {slot: 11, blockRoot: "0x" + "11".repeat(32), payloadStatus: PayloadStatus.FULL},
        {slot: 9, blockRoot: "0x" + "09".repeat(32), payloadStatus: PayloadStatus.FULL},
      ] as ReturnType<IBeaconChain["forkChoice"]["getAllAncestorBlocks"]>);
    } else {
      vi.spyOn(chain, "getHeadState").mockReturnValue({
        slot: 100,
        getBlockRootAtSlot: () => new Uint8Array(32),
      } as unknown as ReturnType<IBeaconChain["getHeadState"]>);
    }
    const archiveRead = vi.spyOn(db.dataColumnSidecarArchive, "getManyBinary");
    expect(await requestRange(10, 1, chain)).toEqual([]);
    expect(archiveRead).not.toHaveBeenCalled();
  });

  if (fork === "gloas") {
    it("should require an archived payload envelope for an unresolved legacy slot", async () => {
      await writeColumns(10, "legacy");
      await db.executionPayloadEnvelopeArchive.delete(10);
      await db.init();
      const archiveRead = vi.spyOn(db.dataColumnSidecarArchive, "getManyBinary");
      expect(await requestRange(10, 1)).toEqual([]);
      expect(archiveRead).not.toHaveBeenCalled();
    });
  }
});
