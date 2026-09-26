import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {PeerId} from "@libp2p/interface";
import {describe, expect, it, vi} from "vitest";
import {LevelDbController} from "@lodestar/db";
import {PayloadStatus} from "@lodestar/fork-choice";
import {ForkName, NUMBER_OF_COLUMNS, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ResponseOutgoing} from "@lodestar/reqresp";
import {ssz, sszTypesFor} from "@lodestar/types";
import {Logger, defer, toRootHex} from "@lodestar/utils";
import {BeaconChain} from "../../../../../src/chain/chain.js";
import {IBeaconChain} from "../../../../../src/chain/interface.js";
import {LightClientServer} from "../../../../../src/chain/lightClient/index.js";
import {ServingContext} from "../../../../../src/chain/serving/context.js";
import {BeaconDb} from "../../../../../src/db/beacon.js";
import {onBeaconBlocksByRange} from "../../../../../src/network/reqresp/handlers/beaconBlocksByRange.js";
import {onBeaconBlocksByRoot} from "../../../../../src/network/reqresp/handlers/beaconBlocksByRoot.js";
import {onBlobSidecarsByRange} from "../../../../../src/network/reqresp/handlers/blobSidecarsByRange.js";
import {onBlobSidecarsByRoot} from "../../../../../src/network/reqresp/handlers/blobSidecarsByRoot.js";
import {onDataColumnSidecarsByRange} from "../../../../../src/network/reqresp/handlers/dataColumnSidecarsByRange.js";
import {onDataColumnSidecarsByRoot} from "../../../../../src/network/reqresp/handlers/dataColumnSidecarsByRoot.js";
import {onLightClientBootstrap} from "../../../../../src/network/reqresp/handlers/lightClientBootstrap.js";
import {onLightClientUpdatesByRange} from "../../../../../src/network/reqresp/handlers/lightClientUpdatesByRange.js";
import {HostServingBudget} from "../../../../../src/network/reqresp/serving/budget.js";
import {startServingHandler} from "../../../../../src/network/reqresp/serving/handler.js";
import {resolveServingPolicy} from "../../../../../src/network/reqresp/serving/policy.js";
import {ReqRespMethod} from "../../../../../src/network/reqresp/types.js";
import {SerializedCache} from "../../../../../src/util/serializedCache.js";
import {servingConfig} from "../../../../utils/network/reqresp/servingCases.js";

const config = servingConfig();
const policy = resolveServingPolicy(config, 6, 0);
const root = new Uint8Array(32).fill(1);
const rootHex = toRootHex(root);
const slot = 6 * SLOTS_PER_EPOCH;
const blobSlot = 3 * SLOTS_PER_EPOCH;
const logger = {debug: vi.fn(), verbose: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn()} as unknown as Logger;
const peer = {toString: () => "peer"} as PeerId;

type Read = {
  call: "get" | "getMany" | "iterator" | "nextv" | "next";
  fillCache?: boolean;
  size?: number;
};
type LevelOptions = {fillCache?: boolean};
type LevelIterator = {
  nextv(size: number, ...rest: unknown[]): Promise<unknown>;
  next(...rest: unknown[]): Promise<unknown>;
};
/** The classic-level instance behind the controller, as far as these tests touch it */
type Level = {
  get(key: Uint8Array, opts?: LevelOptions): Promise<unknown>;
  getMany(keys: Uint8Array[], opts?: LevelOptions): Promise<unknown>;
  iterator(opts?: LevelOptions): LevelIterator;
  compactRange(start: Uint8Array, end: Uint8Array): Promise<void>;
  getProperty(name: string): string;
};

/** A real LevelDB whose classic-level reads are recorded */
async function withDb(
  run: (db: BeaconDb, reads: Read[], level: Level) => Promise<void>,
  {delay}: {delay?: Promise<void>} = {}
): Promise<void> {
  const path = await mkdtemp(join(tmpdir(), "lodestar-stock-reads-"));
  const controller = await LevelDbController.create({name: path}, {logger});
  const level = (controller as unknown as {db: Level}).db;
  const reads: Read[] = [];
  const wait = async (): Promise<void> => {
    if (delay) await delay;
  };
  const get = level.get.bind(level);
  const getMany = level.getMany.bind(level);
  const iterator = level.iterator.bind(level);
  level.get = async (key, opts) => {
    reads.push({call: "get", fillCache: opts?.fillCache});
    await wait();
    return get(key, opts);
  };
  level.getMany = async (keys, opts) => {
    reads.push({call: "getMany", fillCache: opts?.fillCache});
    await wait();
    return getMany(keys, opts);
  };
  level.iterator = (opts) => {
    reads.push({call: "iterator", fillCache: opts?.fillCache});
    const it = iterator(opts);
    const nextv = it.nextv.bind(it);
    const next = it.next.bind(it);
    it.nextv = async (size, ...rest) => {
      reads.push({call: "nextv", size});
      await wait();
      return nextv(size, ...rest);
    };
    it.next = (...rest) => {
      reads.push({call: "next"});
      return next(...rest);
    };
    return it;
  };
  try {
    await run(new BeaconDb(config, controller), reads, level);
  } finally {
    await controller.close();
    await rm(path, {recursive: true, force: true});
  }
}

function makeChain(db: BeaconDb): IBeaconChain {
  return {
    config,
    db,
    logger,
    metrics: null,
    earliestAvailableSlot: 0,
    clock: {currentSlot: slot, currentEpoch: 6},
    custodyConfig: {
      custodyColumns: Array.from({length: NUMBER_OF_COLUMNS}, (_, i) => i),
      custodyColumnsIndex: new Uint8Array(NUMBER_OF_COLUMNS).fill(1),
    },
    serializedCache: new SerializedCache(),
    seenBlockInputCache: {get: () => undefined},
    forkChoice: {
      getBlockHexDefaultStatus: (key: string) =>
        key === rootHex ? {slot: blobSlot, blockRoot: key, payloadStatus: PayloadStatus.FULL} : null,
      getFinalizedBlock: () => ({slot}),
      getFinalizedCheckpointSlot: () => slot,
      getHead: () => ({slot, blockRoot: rootHex, payloadStatus: PayloadStatus.FULL}),
      getAllAncestorBlocks: () => [],
      iterateAncestorBlocks: () => [].values(),
    },
    getSerializedBlockByRoot: BeaconChain.prototype.getSerializedBlockByRoot,
    getSerializedDataColumnSidecars: BeaconChain.prototype.getSerializedDataColumnSidecars,
    getSerializedBlobSidecars: BeaconChain.prototype.getSerializedBlobSidecars,
  } as unknown as IBeaconChain;
}

function blob(marker = 0) {
  const sidecar = ssz.deneb.BlobSidecar.defaultValue();
  sidecar.signedBlockHeader.message.slot = blobSlot;
  sidecar.blob[0] = marker;
  return sidecar;
}

function column(index: number, blobs = 0): Uint8Array {
  const value = ssz.fulu.DataColumnSidecar.defaultValue();
  value.index = index;
  value.signedBlockHeader.message.slot = slot;
  value.column = Array.from({length: blobs}, () => ssz.fulu.Cell.defaultValue());
  value.kzgCommitments = Array.from({length: blobs}, () => ssz.deneb.KZGCommitment.defaultValue());
  value.kzgProofs = Array.from({length: blobs}, () => ssz.deneb.KZGProof.defaultValue());
  return ssz.fulu.DataColumnSidecar.serialize(value);
}

/** Seeds one row of every served repository */
async function seed(db: BeaconDb): Promise<LightClientServer> {
  const block = ssz.altair.SignedBeaconBlock.defaultValue();
  await db.block.putBinary(root, ssz.altair.SignedBeaconBlock.serialize(block));
  for (const archived of [0, 1]) {
    block.message.slot = archived;
    await db.blockArchive.put(archived, block);
  }
  await db.blobSidecars.put(root, {blockRoot: root, slot: blobSlot, blobSidecars: [blob(1), blob(2)]});
  await db.blobSidecarsArchive.put(blobSlot, {blockRoot: root, slot: blobSlot, blobSidecars: [blob(3)]});
  await db.dataColumnSidecarArchive.putBinary(slot, 0, column(0));
  await db.dataColumnSidecarArchive.putBinary(slot, 2, column(2));
  const types = sszTypesFor(ForkName.fulu);
  const header = types.LightClientHeader.defaultValue();
  header.beacon.slot = config.forks.fulu.epoch * SLOTS_PER_EPOCH;
  const committeeRoot = new Uint8Array(32).fill(3);
  await db.syncCommitteeWitness.put(root, {
    witness: Array.from({length: 5}, () => new Uint8Array(32)),
    currentSyncCommitteeRoot: committeeRoot,
    nextSyncCommitteeRoot: committeeRoot,
  });
  await db.syncCommittee.put(committeeRoot, ssz.altair.SyncCommittee.defaultValue());
  await db.checkpointHeader.put(root, header);
  const update = types.LightClientUpdate.defaultValue();
  update.attestedHeader.beacon.slot = header.beacon.slot;
  await db.bestLightClientUpdate.put(0, update);
  return {
    db,
    getBootstrap: LightClientServer.prototype.getBootstrap,
    getUpdate: LightClientServer.prototype.getUpdate,
  } as unknown as LightClientServer;
}

/** Every served source, each a separate request under its own context */
function sources(
  chain: IBeaconChain,
  db: BeaconDb
): Record<string, (context?: ServingContext) => AsyncIterable<ResponseOutgoing>> {
  return {
    blocksByRoot: (context) => onBeaconBlocksByRoot([root], chain, context),
    blocksByRange: (context) =>
      onBeaconBlocksByRange({startSlot: 0, count: 2, step: 1}, chain, db, peer, "test", context),
    // By root serves only unfinalized blobs
    blobsByRoot: (context) =>
      onBlobSidecarsByRoot(
        [
          {blockRoot: root, index: 1},
          {blockRoot: root, index: 0},
        ],
        {...chain, forkChoice: {...chain.forkChoice, getFinalizedBlock: () => ({slot: 0})}} as IBeaconChain,
        context
      ),
    blobsByRange: (context) => onBlobSidecarsByRange({startSlot: blobSlot, count: 1}, chain, db, context),
    columnsByRoot: (context) =>
      onDataColumnSidecarsByRoot(
        [{blockRoot: new Uint8Array(32).fill(9), columns: [2, 0, 2]}],
        chain,
        db,
        peer,
        "test",
        context
      ),
    columnsByRange: (context) =>
      onDataColumnSidecarsByRange({startSlot: slot, count: 1, columns: [2, 0, 2]}, chain, db, peer, "test", context),
    bootstrap: (context) => onLightClientBootstrap(root, chain, context),
    updates: (context) => onLightClientUpdatesByRange({startPeriod: 0, count: 1}, chain, context),
  };
}

describe("stock serving reads", () => {
  it("keep every serving read out of the block cache and refuse uncertified blocks before reading them", async () =>
    withDb(async (db, reads) => {
      const chain = {...makeChain(db), lightClientServer: await seed(db)};
      // The root index row of the unknown by-root column request
      await db.blockArchive.batchPutBinary([
        {key: slot, value: new Uint8Array(8), slot, blockRoot: new Uint8Array(32).fill(9), parentRoot: root},
      ]);
      for (const [name, source] of Object.entries(sources(chain, db))) {
        const expected = await Array.fromAsync(source());
        expect(expected.length, name).toBeGreaterThan(0);
        reads.length = 0;
        const served = Array.fromAsync(source(new ServingContext(policy)));
        if (name === "blocksByRoot" || name === "blocksByRange") {
          // No stored block is certified before the certification loads and this run's hot scan passes
          await expect(served, name).rejects.toMatchObject({code: "HOST_SERVING_CAPACITY"});
          expect(reads, name).toEqual([]);
          continue;
        }
        expect(await served, name).toEqual(expected);
        const opened = reads.filter((read) => read.call !== "nextv" && read.call !== "next");
        expect(opened.length, name).toBeGreaterThan(0);
        expect(opened, name).toEqual(opened.map(({call}) => ({call, fillCache: false})));
      }
    }));

  it("read certified blocks outside the block cache and refuse blocks in unverified archive slots before reading them", async () =>
    withDb(async (db, reads) => {
      // A database certified from its start: every block below was written by a capped writer
      expect(await db.blockCertification.load()).toBeNull();
      const chain = {...makeChain(db), lightClientServer: await seed(db)};
      const archivedRoot = new Uint8Array(32).fill(5);
      await db.blockArchive.batchPutBinary([
        {
          key: 1,
          value: (await db.blockArchive.getBinary(1)) as Uint8Array,
          slot: 1,
          blockRoot: archivedRoot,
          parentRoot: root,
        },
      ]);
      expect(await db.blockCertification.scanHot()).toBeNull();
      const {blocksByRoot, blocksByRange} = sources(chain, db);
      const archivedByRoot = (context?: ServingContext) => onBeaconBlocksByRoot([archivedRoot], chain, context);
      for (const source of [blocksByRoot, blocksByRange, archivedByRoot]) {
        const expected = await Array.fromAsync(source());
        reads.length = 0;
        expect(await Array.fromAsync(source(new ServingContext(policy)))).toEqual(expected);
        const opened = reads.filter((read) => read.call !== "nextv" && read.call !== "next");
        expect(opened.length).toBeGreaterThan(0);
        expect(opened).toEqual(opened.map(({call}) => ({call, fillCache: false})));
      }

      // Finalization copied an oversized block into slot 1, so serving refuses it and any range holding it
      await db.blockCertification.unverifyOversized([{slot: 1, bytes: config.MAX_PAYLOAD_SIZE + 1}]);
      reads.length = 0;
      await expect(Array.fromAsync(blocksByRange(new ServingContext(policy)))).rejects.toMatchObject({
        code: "HOST_SERVING_CAPACITY",
      });
      expect(reads).toEqual([]);
      // Only the root index row is read before the block behind it is refused
      await expect(Array.fromAsync(archivedByRoot(new ServingContext(policy)))).rejects.toMatchObject({
        code: "HOST_SERVING_CAPACITY",
      });
      expect(reads).toEqual([{call: "get", fillCache: false}]);
    }));

  it("refuse a missing-column block read while this run's hot scan has not passed", async () =>
    withDb(async (db, reads) => {
      // The archive is certified, but an oversized hot block may be copied into it by finalization at any time
      expect(await db.blockCertification.load()).toBeNull();
      const block = ssz.fulu.SignedBeaconBlock.defaultValue();
      block.message.slot = slot;
      block.message.body.executionPayload.transactions = [new Uint8Array(config.MAX_PAYLOAD_SIZE)];
      const bytes = ssz.fulu.SignedBeaconBlock.serialize(block);
      await db.block.putBinary(root, bytes);
      expect(await db.blockCertification.scanHot()).toMatchObject({slot, bytes: bytes.byteLength});
      await db.blockArchive.batchPutBinary([{key: slot, value: bytes, slot, blockRoot: root, parentRoot: root}]);

      reads.length = 0;
      const served = Array.fromAsync(
        onDataColumnSidecarsByRange(
          {startSlot: slot, count: 1, columns: [1]},
          makeChain(db),
          db,
          peer,
          "test",
          new ServingContext(policy)
        )
      );
      await expect(served).rejects.toMatchObject({code: "HOST_SERVING_CAPACITY"});
      // The column lookup ran; the block read behind the missing column never did
      expect(reads).toEqual([{call: "getMany", fillCache: false}]);
    }));

  it("read a stock range one row per native read and keep its snapshot under writes", async () =>
    withDb(async (db, reads) => {
      const chain = makeChain(db);
      for (const rowSlot of [blobSlot, blobSlot + 1, blobSlot + 2]) {
        await db.blobSidecarsArchive.put(rowSlot, {blockRoot: root, slot: rowSlot, blobSidecars: [blob(rowSlot)]});
      }
      const request = {startSlot: blobSlot, count: 3};
      const expected = await Array.fromAsync(onBlobSidecarsByRange(request, chain, db));
      reads.length = 0;
      const iterator = onBlobSidecarsByRange(request, chain, db, new ServingContext(policy))[Symbol.asyncIterator]();
      try {
        const first = await iterator.next();
        // A write after the stream opened is not visible to it
        await db.blobSidecarsArchive.put(blobSlot + 1, {blockRoot: root, slot: blobSlot + 1, blobSidecars: [blob(99)]});
        const rest = [(await iterator.next()).value, (await iterator.next()).value];
        expect([first.value, ...rest]).toEqual(expected);
        expect((await iterator.next()).done).toBe(true);
      } finally {
        await iterator.return?.();
      }
      expect(reads.filter((read) => read.call === "iterator")).toEqual([{call: "iterator", fillCache: false}]);
      // Each native read returns one row; default batching never runs
      const pulls = reads.filter((read) => read.call === "nextv" || read.call === "next");
      expect(pulls.every((read) => read.call === "nextv" && read.size === 1)).toBe(true);
      expect(pulls.length).toBeGreaterThanOrEqual(3);
    }));

  it("retire a cancelled stock getMany only after its outstanding read settles", async () => {
    const gate = defer<void>();
    await withDb(
      async (db, reads) => {
        await db.dataColumnSidecarArchive.putBinary(slot, 0, column(0));
        const chain = makeChain(db);
        const budget = HostServingBudget.forEnvironment(policy);
        const handler = startServingHandler(
          budget,
          (context) =>
            onDataColumnSidecarsByRange({startSlot: slot, count: 1, columns: [0, 0]}, chain, db, peer, "test", context),
          undefined,
          "peer",
          ReqRespMethod.DataColumnSidecarsByRange
        );
        const next = handler.next();
        await vi.waitFor(() => expect(reads.some((read) => read.call === "getMany")).toBe(true));
        handler.cancel();
        let retired = false;
        void handler.retired.then(() => {
          retired = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(retired).toBe(false);
        expect(budget.snapshot()).toMatchObject({occupancy: 1, outstandingRetirements: 1});
        gate.resolve();
        await Promise.allSettled([next]);
        await handler.retired;
        expect(budget.snapshot()).toMatchObject({occupancy: 0, outstandingRetirements: 0, reservedBytes: 0});
      },
      {delay: gate.promise}
    );
  });

  it("retire a cancelled stock range stream only after its outstanding row read settles and the stream closes", async () => {
    const gate = defer<void>();
    await withDb(
      async (db, reads) => {
        await db.blobSidecarsArchive.put(blobSlot, {blockRoot: root, slot: blobSlot, blobSidecars: [blob(1)]});
        const chain = makeChain(db);
        const budget = HostServingBudget.forEnvironment(policy);
        const handler = startServingHandler(
          budget,
          (context) => onBlobSidecarsByRange({startSlot: blobSlot, count: 1}, chain, db, context),
          undefined,
          "peer",
          ReqRespMethod.BlobSidecarsByRange
        );
        const next = handler.next();
        await vi.waitFor(() => expect(reads.some((read) => read.call === "nextv")).toBe(true));
        handler.cancel();
        let retired = false;
        void handler.retired.then(() => {
          retired = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(retired).toBe(false);
        gate.resolve();
        await Promise.allSettled([next]);
        await handler.retired;
        expect(budget.snapshot()).toMatchObject({occupancy: 0, outstandingRetirements: 0, reservedBytes: 0});
      },
      {delay: gate.promise}
    );
  });

  it("leave the LevelDB block cache unchanged for served values that a default read would cache", async () =>
    withDb(async (db, _reads, level) => {
      const chain = makeChain(db);
      const blobSidecars = Array.from({length: config.MAX_BLOBS_PER_BLOCK_ELECTRA}, () => blob());
      await db.blobSidecars.put(root, {blockRoot: root, slot: blobSlot, blobSidecars});
      for (let index = 0; index < NUMBER_OF_COLUMNS; index++) {
        await db.dataColumnSidecarArchive.putBinary(slot, index, column(index, 21));
      }
      // Move the rows out of the memtable, so reads load compressed table blocks
      await level.compactRange(new Uint8Array([0]), new Uint8Array([255]));
      const usage = (): number => Number(level.getProperty("leveldb.approximate-memory-usage"));
      const before = usage();
      const unfinalized = {...chain, forkChoice: {...chain.forkChoice, getFinalizedBlock: () => ({slot: 0})}};
      const blobs = await Array.fromAsync(
        onBlobSidecarsByRoot([{blockRoot: root, index: 0}], unfinalized as IBeaconChain, new ServingContext(policy))
      );
      const columns = await Array.fromAsync(
        onDataColumnSidecarsByRange(
          {startSlot: slot, count: 1, columns: Array.from({length: NUMBER_OF_COLUMNS}, (_, i) => i)},
          chain,
          db,
          peer,
          "test",
          new ServingContext(policy)
        )
      );
      expect(blobs).toHaveLength(1);
      expect(columns).toHaveLength(NUMBER_OF_COLUMNS);
      expect(usage() - before).toBeLessThan(64 * 1024);
      // The same rows read with the stock default fill the cache
      await db.blobSidecars.getBinary(root);
      await db.dataColumnSidecarArchive.getManyBinary(slot, [0, 1, 2]);
      expect(usage() - before).toBeGreaterThan(1024 * 1024);
    }));
});
