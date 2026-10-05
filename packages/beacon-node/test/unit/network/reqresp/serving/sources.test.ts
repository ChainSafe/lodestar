import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {PeerId} from "@libp2p/interface";
import {describe, expect, it, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {LevelDbController} from "@lodestar/db";
import {PayloadStatus, ProtoArray} from "@lodestar/fork-choice";
import {ForkName, NUMBER_OF_COLUMNS, SLOTS_PER_EPOCH} from "@lodestar/params";
import {RespStatus, ResponseOutgoing} from "@lodestar/reqresp";
import {ssz, sszTypesFor} from "@lodestar/types";
import {Logger, byteArrayEquals, defer, intToBytes, toRootHex} from "@lodestar/utils";
import {BlockInputColumns, BlockInputPreData} from "../../../../../src/chain/blocks/blockInput/blockInput.js";
import {BlockInputSource} from "../../../../../src/chain/blocks/blockInput/types.js";
import {BeaconChain} from "../../../../../src/chain/chain.js";
import {IBeaconChain} from "../../../../../src/chain/interface.js";
import {LightClientServer} from "../../../../../src/chain/lightClient/index.js";
import {ServingCapacityError, ServingContext} from "../../../../../src/chain/serving/context.js";
import {BeaconDb} from "../../../../../src/db/beacon.js";
import {getRootIndexKey} from "../../../../../src/db/repositories/blockArchiveIndex.js";
import {
  collectServingHeadRange,
  onBeaconBlocksByRange,
} from "../../../../../src/network/reqresp/handlers/beaconBlocksByRange.js";
import {onBeaconBlocksByRoot} from "../../../../../src/network/reqresp/handlers/beaconBlocksByRoot.js";
import {onBlobSidecarsByRange} from "../../../../../src/network/reqresp/handlers/blobSidecarsByRange.js";
import {onBlobSidecarsByRoot} from "../../../../../src/network/reqresp/handlers/blobSidecarsByRoot.js";
import {onDataColumnSidecarsByRange} from "../../../../../src/network/reqresp/handlers/dataColumnSidecarsByRange.js";
import {onDataColumnSidecarsByRoot} from "../../../../../src/network/reqresp/handlers/dataColumnSidecarsByRoot.js";
import {onLightClientBootstrap} from "../../../../../src/network/reqresp/handlers/lightClientBootstrap.js";
import {onLightClientUpdatesByRange} from "../../../../../src/network/reqresp/handlers/lightClientUpdatesByRange.js";
import {HostServingBudget} from "../../../../../src/network/reqresp/serving/budget.js";
import {createBoundedServing, startServingHandler} from "../../../../../src/network/reqresp/serving/handler.js";
import {resolveServingPolicy} from "../../../../../src/network/reqresp/serving/policy.js";
import {ReqRespMethod} from "../../../../../src/network/reqresp/types.js";
import {SerializedCache} from "../../../../../src/util/serializedCache.js";
import {decodedBackingBytes, servingConfig} from "../../../../utils/network/reqresp/servingCases.js";
import {generateProtoBlock} from "../../../../utils/typeGenerator.js";

const config = servingConfig();
const policy = resolveServingPolicy(config, 6, 0);
const root = new Uint8Array(32).fill(1);
const rootHex = toRootHex(root);
const slot = 6 * SLOTS_PER_EPOCH;
const logger = {debug: vi.fn(), verbose: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn()} as unknown as Logger;
const peer = {toString: () => "peer"} as PeerId;

async function withDb(run: (db: BeaconDb, controller: LevelDbController) => Promise<void>): Promise<void> {
  const path = await mkdtemp(join(tmpdir(), "lodestar-serving-"));
  const controller = await LevelDbController.create({name: path}, {logger});
  try {
    const db = new BeaconDb(config, controller, {dataColumnDir: join(path, "columns"), logger});
    await db.init();
    await run(db, controller);
  } finally {
    await controller.close();
    await rm(path, {recursive: true, force: true});
  }
}
function makeChain(db: BeaconDb): IBeaconChain {
  const chain = {
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
    getHeadState: () => ({slot: 0}),
    forkChoice: {
      getBlockHexDefaultStatus: () => ({slot, blockRoot: rootHex, payloadStatus: PayloadStatus.FULL}),
      getFinalizedBlock: () => ({slot: 0}),
      getFinalizedCheckpointSlot: () => 0,
      getHead: () => ({slot: 0, blockRoot: rootHex, payloadStatus: PayloadStatus.FULL}),
      getAllAncestorBlocks: () => [],
      iterateAncestorBlocks: () => [].values(),
    },
    getSerializedBlockByRoot: BeaconChain.prototype.getSerializedBlockByRoot,
    getSerializedDataColumnSidecars: BeaconChain.prototype.getSerializedDataColumnSidecars,
    getSerializedBlobSidecars: BeaconChain.prototype.getSerializedBlobSidecars,
  } as unknown as IBeaconChain;
  return chain;
}
function column(index: number, marker = 0): Uint8Array {
  const value = ssz.fulu.DataColumnSidecar.defaultValue();
  value.index = index;
  value.signedBlockHeader.message.slot = slot;
  value.signedBlockHeader.signature.fill(marker);
  return ssz.fulu.DataColumnSidecar.serialize(value);
}
function columns(
  chain: IBeaconChain,
  db: BeaconDb,
  indices: number[],
  context?: ServingContext
): AsyncIterable<ResponseOutgoing> {
  return onDataColumnSidecarsByRoot([{blockRoot: root, columns: indices}], chain, db, peer, "test", context);
}

describe("actual serving sources", () => {
  it("checks the serving fork at factory initialization", async () =>
    withDb(async (db) => {
      const chain = makeChain(db);
      const future = createBeaconConfig({...config, GLOAS_FORK_EPOCH: 7}, new Uint8Array(32));
      const futureChain = {...chain, config: future, clock: {...chain.clock, currentSlot: chain.clock.currentSlot}};
      const futurePolicy = resolveServingPolicy(future, 6, futureChain.clock.currentSlot);
      const budget = HostServingBudget.forEnvironment(futurePolicy);
      futureChain.clock.currentSlot = -1;
      expect(createBoundedServing({chain: futureChain, db}, budget).getHandler).toBeTypeOf("function");
      futureChain.clock.currentSlot = slot;
      const {getHandler: factory} = createBoundedServing({chain: futureChain, db}, budget);
      expect(factory).toBeTypeOf("function");
      for (const currentSlot of [7 * SLOTS_PER_EPOCH, 8 * SLOTS_PER_EPOCH]) {
        futureChain.clock.currentSlot = currentSlot;
        expect(() => createBoundedServing({chain: futureChain, db}, budget)).toThrow("gloas");
        expect(() => factory(ReqRespMethod.BeaconBlocksByRoot)({data: root, version: 2}, peer, "test")).toThrow(
          "gloas"
        );
        expect(budget.snapshot().occupancy).toBe(0);
      }
    }));

  it("counts real ProtoArray ancestors, including newer skipped nodes and pruning", async () =>
    withDb(async (db) => {
      const rootFor = (slot: number) => toRootHex(new Uint8Array(32).fill(slot));
      const proto = ProtoArray.initialize(generateProtoBlock({blockRoot: rootFor(0)}), 0);
      let parentRoot = rootFor(0);
      for (const slot of [2, 4, 8, 10]) {
        proto.onBlock(generateProtoBlock({slot, blockRoot: rootFor(slot), parentRoot}), slot, null);
        parentRoot = rootFor(slot);
      }
      const head = proto.getNode(rootFor(10), PayloadStatus.FULL);
      if (!head) throw Error("Missing fixture head");
      const chain = {
        ...makeChain(db),
        forkChoice: {
          getHead: () => head,
          iterateAncestorBlocks: (root: string, status: PayloadStatus) => proto.iterateAncestorNodes(root, status),
          getAllAncestorBlocks: (root: string, status: PayloadStatus) => proto.getAllAncestorNodes(root, status),
        },
      } as unknown as IBeaconChain;
      const records = collectServingHeadRange(chain, 1, 5, 0, new ServingContext(policy));
      expect(records.map((record) => record.slot)).toEqual([2, 4]);
      expect(records.every((record) => Object.keys(record).sort().join() === "blockRoot,payloadStatus,slot")).toBe(
        true
      );
      proto.maybePrune(rootFor(4));
      expect(collectServingHeadRange(chain, 1, 5, 0, new ServingContext(policy)).map((record) => record.slot)).toEqual([
        4,
      ]);
      const node = proto.getNode(rootFor(4), PayloadStatus.FULL);
      if (!node) throw Error("Missing fixture node");
      node.slot = 44;
      expect(records.map((record) => record.slot)).toEqual([2, 4]);
    }));

  it("acquires before actual factory request decoding", async () =>
    withDb(async (db) => {
      const chain = makeChain(db);
      const budget = HostServingBudget.forEnvironment({...policy, capacity: 1});
      const hold = defer<void>();
      const first = startServingHandler(budget, async function* () {
        await hold.promise;
        yield* [];
      });
      const pending = first.next();
      const actual = createBoundedServing({chain, db}, budget).getHandler(ReqRespMethod.BeaconBlocksByRoot);
      try {
        expect(() => actual({data: new Uint8Array(31), version: 2}, peer, "test")).toThrow("capacity");
      } finally {
        hold.resolve();
        await pending;
        await first.retired;
      }
      const invalid = actual({data: new Uint8Array(31), version: 2}, peer, "test");
      await expect(invalid.next()).rejects.toThrow();
      await invalid.retired;
      expect(budget.snapshot().occupancy).toBe(0);
    }));

  for (const failed of [0, 1]) {
    it(`retains real decoded committee sibling ${1 - failed} after cancelled bootstrap failure`, async () =>
      withDb(async (db) => {
        const currentRoot = new Uint8Array(32).fill(3),
          nextRoot = new Uint8Array(32).fill(4);
        await db.syncCommitteeWitness.put(root, {
          witness: new Array<Uint8Array>(5).fill(new Uint8Array(32)),
          currentSyncCommitteeRoot: currentRoot,
          nextSyncCommitteeRoot: nextRoot,
        });
        const committee = ssz.altair.SyncCommittee.defaultValue();
        await db.syncCommittee.put(currentRoot, committee);
        await db.syncCommittee.put(nextRoot, committee);
        const gates = [defer<void>(), defer<void>()];
        const starts = [defer<void>(), defer<void>()];
        const original = db.syncCommittee.get.bind(db.syncCommittee);
        let calls = 0;
        const spy = vi.spyOn(db.syncCommittee, "get").mockImplementation(async (key, opts) => {
          const index = calls++;
          if (index >= 2) throw Error("Fixture operation bound");
          const value = await original(key, opts);
          starts[index].resolve();
          await gates[index].promise;
          return value;
        });
        const server = {db, getBootstrap: LightClientServer.prototype.getBootstrap} as unknown as LightClientServer;
        const chain = {...makeChain(db), lightClientServer: server};
        const budget = HostServingBudget.forEnvironment(policy);
        let source: ServingContext | undefined;
        const handler = startServingHandler(budget, (context) => {
          source = context;
          return onLightClientBootstrap(root, chain, context);
        });
        const next = handler.next().catch(() => undefined);
        let retired = false;
        void handler.retired.then(() => {
          retired = true;
        });
        try {
          await Promise.all(starts.map((part) => part.promise));
          expect(source?.snapshot()).toMatchObject({
            pendingOperations: 2,
            pendingSourceLimitBytes: 2 * policy.lightClient.committee,
          });
          handler.cancel();
          gates[failed].reject(Error("read failed"));
          await next;
          expect(retired).toBe(false);
          expect(source?.pendingOperations).toBe(1);
          expect(budget.snapshot()).toMatchObject({occupancy: 1, outstandingRetirements: 1});
        } finally {
          for (const gate of gates) gate.resolve();
          await next;
          await handler.retired;
          spy.mockRestore();
        }
        expect(source?.pendingOperations).toBe(0);
        expect(budget.snapshot()).toMatchObject({occupancy: 0, outstandingRetirements: 0});
      }));
  }

  it("preserves finalized blob and column range response arrays", async () =>
    withDb(async (db) => {
      const chain = makeChain(db);
      const blobSlot = 3 * SLOTS_PER_EPOCH;
      const blob = ssz.deneb.BlobSidecar.defaultValue();
      blob.signedBlockHeader.message.slot = blobSlot;
      await db.blobSidecarsArchive.put(blobSlot, {blockRoot: root, slot: blobSlot, blobSidecars: [blob, blob]});
      vi.spyOn(chain.forkChoice, "getFinalizedBlock").mockReturnValue({slot} as ReturnType<
        IBeaconChain["forkChoice"]["getHead"]
      >);
      const request = {startSlot: blobSlot, count: 1};
      const ordinary = await Array.fromAsync(onBlobSidecarsByRange(request, chain, db));
      const bounded = await Array.fromAsync(onBlobSidecarsByRange(request, chain, db, new ServingContext(policy)));
      expect(bounded).toEqual(ordinary);
      expect(bounded).toHaveLength(2);
      await db.blockArchive.batchPutBinary([
        {key: slot, value: new Uint8Array(), slot, blockRoot: root, parentRoot: root},
      ]);
      await db.dataColumns.putManyBinary({slot, blockRoot: rootHex}, [
        {index: 0, data: column(0)},
        {index: 2, data: column(2)},
      ]);
      const columnRequest = {startSlot: slot, count: 1, columns: [2, 0, 2]};
      expect(
        await Array.fromAsync(
          onDataColumnSidecarsByRange(columnRequest, chain, db, peer, "test", new ServingContext(policy))
        )
      ).toEqual(await Array.fromAsync(onDataColumnSidecarsByRange(columnRequest, chain, db, peer, "test")));
    }));

  it("admits the full configured 128-occurrence B21 cache batch", async () =>
    withDb(async (db) => {
      const chain = makeChain(db);
      const block = ssz.fulu.SignedBeaconBlock.defaultValue();
      block.message.slot = slot;
      block.message.body.blobKzgCommitments = Array.from({length: 21}, () => new Uint8Array(48));
      const input = BlockInputColumns.createFromBlock({
        block,
        blockRootHex: rootHex,
        forkName: ForkName.fulu,
        daOutOfRange: true,
        source: BlockInputSource.byRoot,
        seenTimestampSec: 0,
        sampledColumns: [],
        custodyColumns: [],
      });
      const value = ssz.fulu.DataColumnSidecar.defaultValue();
      value.signedBlockHeader.message.slot = slot;
      value.column = Array.from({length: 21}, () =>
        ssz.fulu.DataColumnSidecar.fields.column.elementType.defaultValue()
      );
      value.kzgCommitments = Array.from({length: 21}, () => new Uint8Array(48));
      value.kzgProofs = Array.from({length: 21}, () => new Uint8Array(48));
      input.addColumn({
        blockRootHex: rootHex,
        columnSidecar: value,
        source: BlockInputSource.byRoot,
        seenTimestampSec: 0,
      });
      vi.spyOn(chain.seenBlockInputCache, "get").mockReturnValue(input);
      const context = new ServingContext(policy);
      const batch = await Array.fromAsync(columns(chain, db, new Array<number>(NUMBER_OF_COLUMNS).fill(0), context));
      const expected = ssz.fulu.DataColumnSidecar.serialize(value);
      expect(batch).toHaveLength(NUMBER_OF_COLUMNS);
      expect(batch.every((response) => byteArrayEquals(response.data, expected))).toBe(true);
      expect(batch.reduce((total, response) => total + response.data.buffer.byteLength, 0)).toBe(5808640);
    }));

  it("retains a cancelled serving lease until its flat-file read settles", async () =>
    withDb(async (db) => {
      await db.dataColumns.putManyBinary({slot, blockRoot: rootHex}, [{index: 0, data: column(0)}]);
      const read = db.dataColumns.getManyBinary.bind(db.dataColumns);
      const started = defer<void>();
      const release = defer<void>();
      const pendingRead = vi.spyOn(db.dataColumns, "getManyBinary").mockImplementation(async (...args) => {
        const result = await read(...args);
        started.resolve();
        await release.promise;
        return result;
      });
      const budget = HostServingBudget.forEnvironment(policy);
      const handler = startServingHandler(budget, (context) => columns(makeChain(db), db, [0], context));
      const next = handler.next().catch(() => undefined);
      try {
        await started.promise;
        handler.cancel();
        expect(budget.snapshot()).toMatchObject({occupancy: 1, outstandingRetirements: 1});
      } finally {
        release.resolve();
        await next;
        await handler.retired;
        pendingRead.mockRestore();
      }
      expect(budget.snapshot()).toMatchObject({occupancy: 0, outstandingRetirements: 0});
    }));

  it("preserves a complete duplicate/out-of-order/missing flat-file batch across writes", async () =>
    withDb(async (db) => {
      const chain = makeChain(db);
      await db.dataColumns.putManyBinary({slot, blockRoot: rootHex}, [{index: 0, data: column(0, 1)}]);
      await db.dataColumns.putManyBinary({slot, blockRoot: rootHex}, [{index: 2, data: column(2, 2)}]);
      const indices = [2, 0, 2, 1];
      const ordinary = await Array.fromAsync(columns(chain, db, indices));
      const context = new ServingContext(policy);
      const iterator = columns(chain, db, indices, context)[Symbol.asyncIterator]();
      const responses: ResponseOutgoing[] = [];
      try {
        const first = await iterator.next();
        if (!first.done) responses.push(first.value);
        await db.dataColumns.putManyBinary({slot, blockRoot: rootHex}, [
          {index: 0, data: column(0, 9)},
          {index: 2, data: column(2, 9)},
        ]);
        for (let pulls = 0; pulls < indices.length; pulls++) {
          const item = await iterator.next();
          if (item.done) break;
          responses.push(item.value);
        }
        expect(responses).toEqual(ordinary);
        expect(responses.map((r) => ssz.fulu.DataColumnSidecar.deserialize(r.data).index)).toEqual([2, 0, 2]);
        const archived = await Array.fromAsync(columns(chain, db, indices, new ServingContext(policy)));
        expect(byteArrayEquals(archived[0].data, column(2, 9))).toBe(true);
      } finally {
        await iterator.return?.();
      }
    }));

  it("fills missing cached columns from flat-file storage", async () =>
    withDb(async (db) => {
      await db.dataColumns.putManyBinary({slot, blockRoot: rootHex}, [{index: 0, data: column(0, 1)}]);
      await db.dataColumns.putManyBinary({slot, blockRoot: rootHex}, [{index: 1, data: column(1, 2)}]);
      const chain = makeChain(db);
      expect(
        (await Array.fromAsync(columns(chain, db, [0, 1], new ServingContext(policy)))).map(
          (r) => ssz.fulu.DataColumnSidecar.deserialize(r.data).index
        )
      ).toEqual([0, 1]);
      const block = ssz.fulu.SignedBeaconBlock.defaultValue();
      block.message.slot = slot;
      const input = BlockInputColumns.createFromBlock({
        block,
        blockRootHex: rootHex,
        forkName: ForkName.fulu,
        daOutOfRange: true,
        source: BlockInputSource.byRoot,
        seenTimestampSec: 0,
        sampledColumns: [],
        custodyColumns: [],
      });
      vi.spyOn(chain.seenBlockInputCache, "get").mockReturnValue(input);
      input.addColumn({
        blockRootHex: rootHex,
        columnSidecar: ssz.fulu.DataColumnSidecar.deserialize(column(0, 3)),
        source: BlockInputSource.byRoot,
        seenTimestampSec: 0,
      });
      const served = await Array.fromAsync(columns(chain, db, [0, 1], new ServingContext(policy)));
      expect(served.map(({data}) => data)).toEqual([column(0, 3), column(1, 2)]);
    }));

  it("serializes the complete accepted cached occurrence batch before yielding", async () =>
    withDb(async (db) => {
      const chain = makeChain(db);
      const block = ssz.fulu.SignedBeaconBlock.defaultValue();
      block.message.slot = slot;
      const input = BlockInputColumns.createFromBlock({
        block,
        blockRootHex: rootHex,
        forkName: ForkName.fulu,
        daOutOfRange: true,
        source: BlockInputSource.byRoot,
        seenTimestampSec: 0,
        sampledColumns: [],
        custodyColumns: [],
      });
      const value = ssz.fulu.DataColumnSidecar.deserialize(column(0));
      input.addColumn({
        blockRootHex: rootHex,
        columnSidecar: value,
        source: BlockInputSource.byRoot,
        seenTimestampSec: 0,
      });
      vi.spyOn(chain.seenBlockInputCache, "get").mockReturnValue(input);
      const iterator = columns(chain, db, [0, 0], new ServingContext(policy))[Symbol.asyncIterator]();
      try {
        const first = await iterator.next();
        value.signedBlockHeader.signature.fill(9);
        const second = await iterator.next();
        expect(first).toEqual(second);
        if (!first.done && !second.done) expect(first.value.data.buffer).not.toBe(second.value.data.buffer);
      } finally {
        await iterator.return?.();
      }
    }));

  it("counts duplicate cached backing occurrences and publishes no refused batch", async () =>
    withDb(async (db) => {
      const chain = makeChain(db);
      const block = ssz.fulu.SignedBeaconBlock.defaultValue();
      block.message.slot = slot;
      const input = BlockInputColumns.createFromBlock({
        block,
        blockRootHex: rootHex,
        forkName: ForkName.fulu,
        daOutOfRange: true,
        source: BlockInputSource.byRoot,
        seenTimestampSec: 0,
        sampledColumns: [],
        custodyColumns: [],
      });
      const value = ssz.fulu.DataColumnSidecar.deserialize(column(0));
      input.addColumn({
        blockRootHex: rootHex,
        columnSidecar: value,
        source: BlockInputSource.byRoot,
        seenTimestampSec: 0,
      });
      vi.spyOn(chain.seenBlockInputCache, "get").mockReturnValue(input);
      const backing = new Uint8Array(policy.sourceBytes / 2 + 1);
      backing.set(column(0));
      chain.serializedCache.set(value, backing.subarray(0, column(0).length));
      const iterator = columns(chain, db, [0, 0], new ServingContext(policy))[Symbol.asyncIterator]();
      try {
        await expect(iterator.next()).rejects.toMatchObject({code: "HOST_SERVING_CAPACITY"});
      } finally {
        await iterator.return?.();
      }
    }));

  it("rejects a real over-cap batch before its first response", async () =>
    withDb(async (db) => {
      const chain = makeChain(db);
      await db.dataColumns.putManyBinary({slot, blockRoot: rootHex}, [
        {index: 0, data: new Uint8Array(policy.sourceBytes / 2 + 1)},
      ]);
      const iterator = columns(chain, db, [0, 0], new ServingContext(policy))[Symbol.asyncIterator]();
      try {
        await expect(iterator.next()).rejects.toMatchObject({code: "HOST_SERVING_CAPACITY"});
      } finally {
        await iterator.return?.();
      }
    }));

  it("returns available columns and finishes without a diagnostic block read", async () =>
    withDb(async (db) => {
      const chain = makeChain(db);
      const available = column(0);
      await db.dataColumns.putManyBinary({slot, blockRoot: rootHex}, [{index: 0, data: available}]);
      const getBlock = vi.spyOn(db.block, "getBinary");
      const iterator = columns(chain, db, [0, 1], new ServingContext(policy))[Symbol.asyncIterator]();
      try {
        expect(await iterator.next()).toMatchObject({done: false, value: {data: available}});
        expect(await iterator.next()).toEqual({done: true, value: undefined});
        expect(getBlock).not.toHaveBeenCalled();
      } finally {
        await iterator.return?.();
      }
    }));

  it("serves a hot block and refuses an oversized archived block through the sole factory", async () =>
    withDb(async (db, controller) => {
      const chain = makeChain(db);
      const block = ssz.fulu.SignedBeaconBlock.defaultValue();
      block.message.slot = slot;
      const bytes = ssz.fulu.SignedBeaconBlock.serialize(block);
      await db.block.putBinary(root, bytes);
      const expected = await Array.fromAsync(onBeaconBlocksByRoot([root], chain));
      const budget = HostServingBudget.forEnvironment(policy);
      const handler = createBoundedServing({chain, db}, budget).getHandler(ReqRespMethod.BeaconBlocksByRoot);
      const request = {data: root, version: 2};
      const bounded = handler(request, peer, "test");
      expect(await Array.fromAsync(bounded)).toEqual(expected);
      await bounded.retired;
      await db.block.delete(root);
      // A stored oversized row is refused by the bounded native read.
      await controller.put(getRootIndexKey(root), intToBytes(slot, 8, "be"));
      await controller.put(db.blockArchive.encodeKey(slot), new Uint8Array(policy.sourceBytes + 1));
      const getBinary = vi.spyOn(db.blockArchive, "getBinary");
      const bad = handler(request, peer, "test");
      await expect(bad.next()).rejects.toMatchObject({
        code: "HOST_SERVING_CAPACITY",
        status: RespStatus.SERVER_ERROR,
      });
      await bad.retired;
      expect(getBinary).toHaveBeenCalledOnce();
      expect(budget.snapshot().occupancy).toBe(0);
    }));

  it("bounds cache-miss block size work and exact wire serialization", async () =>
    withDb(async (db) => {
      const chain = makeChain(db);
      const block = ssz.bellatrix.SignedBeaconBlock.defaultValue();
      block.message.slot = SLOTS_PER_EPOCH;
      const base = ssz.bellatrix.SignedBeaconBlock.value_serializedSize(block);
      block.message.body.executionPayload.transactions = [new Uint8Array(policy.blockBytes - base - 4)];
      const input = BlockInputPreData.createFromBlock({
        block,
        blockRootHex: rootHex,
        forkName: ForkName.bellatrix,
        daOutOfRange: true,
        source: BlockInputSource.byRoot,
        seenTimestampSec: 0,
      });
      vi.spyOn(chain.seenBlockInputCache, "get").mockReturnValue(input);
      const exact = await chain.getSerializedBlockByRoot(rootHex, new ServingContext(policy));
      expect(exact?.block.byteLength).toBe(policy.blockBytes);
      expect(exact && byteArrayEquals(exact.block, ssz.bellatrix.SignedBeaconBlock.serialize(block))).toBe(true);
      block.message.body.executionPayload.transactions[0] = new Uint8Array(policy.blockBytes - base - 3);
      await expect(chain.getSerializedBlockByRoot(rootHex, new ServingContext(policy))).rejects.toMatchObject({
        code: "HOST_SERVING_CAPACITY",
      });
      block.message.body.executionPayload.transactions = [new Uint8Array(), new Uint8Array()];
      await expect(
        chain.getSerializedBlockByRoot(rootHex, new ServingContext({...policy, transactionVisits: 1}))
      ).rejects.toThrow("visits");
    }));

  it("retains old/new blob list bytes and exact wrapper response order", async () =>
    withDb(async (db) => {
      const chain = makeChain(db);
      const blobSlot = 3 * SLOTS_PER_EPOCH;
      vi.spyOn(chain.forkChoice, "getBlockHexDefaultStatus").mockImplementation(
        (key) => ({slot: blobSlot, blockRoot: key}) as ReturnType<IBeaconChain["forkChoice"]["getHead"]>
      );
      const root2 = new Uint8Array(32).fill(2);
      const blob1 = ssz.deneb.BlobSidecar.defaultValue();
      blob1.signedBlockHeader.message.slot = blobSlot;
      const blob2 = ssz.deneb.BlobSidecar.defaultValue();
      blob2.signedBlockHeader.message.slot = blobSlot;
      blob2.blob.fill(2);
      await db.blobSidecars.put(root, {blockRoot: root, slot: blobSlot, blobSidecars: [blob1]});
      await db.blobSidecars.put(root2, {blockRoot: root2, slot: blobSlot, blobSidecars: [blob2]});
      const request = [
        {blockRoot: root, index: 0},
        {blockRoot: root2, index: 0},
      ];
      const context = new ServingContext(policy);
      const expected = await Array.fromAsync(onBlobSidecarsByRoot(request, chain));
      const actual = await Array.fromAsync(onBlobSidecarsByRoot(request, chain, context));
      expect(actual).toEqual(expected);
      expect(actual.map((item) => item.data.buffer.byteLength)).toEqual([
        ssz.deneb.BlobSidecar.maxSize,
        ssz.deneb.BlobSidecar.maxSize,
      ]);
    }));

  it("preserves real archive iterator snapshot order under writes", async () =>
    withDb(async (db) => {
      const chain = makeChain(db);
      const block0 = ssz.altair.SignedBeaconBlock.defaultValue();
      block0.message.slot = 0;
      const block1 = ssz.altair.SignedBeaconBlock.defaultValue();
      block1.message.slot = 1;
      await db.blockArchive.put(0, block0);
      await db.blockArchive.put(1, block1);
      vi.spyOn(chain.forkChoice, "getFinalizedCheckpointSlot").mockReturnValue(1);
      const request = {startSlot: 0, count: 2, step: 1};
      const expected = await Array.fromAsync(onBeaconBlocksByRange(request, chain, db, peer, "test"));
      const iterator = onBeaconBlocksByRange(request, chain, db, peer, "test", new ServingContext(policy))[
        Symbol.asyncIterator
      ]();
      try {
        const first = await iterator.next();
        block1.signature.fill(9);
        await db.blockArchive.put(1, block1);
        const second = await iterator.next();
        expect([first.value, second.value]).toEqual(expected);
        expect((await iterator.next()).done).toBe(true);
      } finally {
        await iterator.return?.();
      }
    }));

  it("takes the scalar ancestry snapshot after the actual archive await", async () =>
    withDb(async (db) => {
      const chain = makeChain(db);
      const gate = defer<void>();
      const started = defer<void>();
      const nodes = [3, 2, 0].map((slot) => ({
        slot,
        blockRoot: toRootHex(new Uint8Array(32).fill(slot)),
        payloadStatus: PayloadStatus.FULL,
      }));
      let head = nodes[0];
      const customChain = {
        ...chain,
        forkChoice: {
          ...chain.forkChoice,
          getHead: () => head,
          iterateAncestorBlocks: () => nodes.slice(1).values(),
          getAllAncestorBlocks: () => nodes,
        },
      } as unknown as IBeaconChain;
      const archive = vi.spyOn(db.blockArchive, "binaryEntriesStream").mockImplementation(() =>
        (async function* () {
          started.resolve();
          await gate.promise;
          yield* [];
        })()
      );
      const stored = ssz.altair.SignedBeaconBlock.defaultValue();
      stored.message.slot = 2;
      await db.block.putBinary(new Uint8Array(32).fill(2), ssz.altair.SignedBeaconBlock.serialize(stored));
      vi.spyOn(customChain.forkChoice, "getBlockHexDefaultStatus").mockImplementation(
        (blockRoot) => ({slot: 2, blockRoot}) as ReturnType<IBeaconChain["forkChoice"]["getHead"]>
      );
      const iterator = onBeaconBlocksByRange(
        {startSlot: 0, count: 4, step: 1},
        customChain,
        db,
        peer,
        "test",
        new ServingContext(policy)
      )[Symbol.asyncIterator]();
      const next = iterator.next();
      try {
        await started.promise;
        head = nodes[1];
        nodes.splice(0, 1);
        gate.resolve();
        const item = await next;
        expect(item.done).toBe(false);
        if (!item.done) expect(ssz.altair.SignedBeaconBlock.deserialize(item.value.data).message.slot).toBe(2);
        nodes[0].slot = 99;
        expect((await iterator.next()).done).toBe(true);
      } finally {
        gate.resolve();
        await next;
        await iterator.return?.();
        archive.mockRestore();
      }
    }));

  for (const fork of [
    ForkName.altair,
    ForkName.bellatrix,
    ForkName.capella,
    ForkName.deneb,
    ForkName.electra,
    ForkName.fulu,
  ] as const) {
    it(`uses actual ${fork} light-client encoded rows, both committees and gap semantics`, async () =>
      withDb(async (db) => {
        const forkSlot = config.forks[fork].epoch * SLOTS_PER_EPOCH;
        const types = sszTypesFor(fork);
        const header = types.LightClientHeader.defaultValue();
        header.beacon.slot = forkSlot;
        const currentRoot = new Uint8Array(32).fill(3),
          nextRoot = new Uint8Array(32).fill(4);
        const committee = ssz.altair.SyncCommittee.defaultValue();
        const witness = {
          witness: Array.from(
            {length: fork === ForkName.electra || fork === ForkName.fulu ? 5 : 4},
            () => new Uint8Array(32)
          ),
          currentSyncCommitteeRoot: currentRoot,
          nextSyncCommitteeRoot: nextRoot,
        };
        await db.syncCommitteeWitness.put(root, witness);
        await db.syncCommittee.put(currentRoot, committee);
        await db.syncCommittee.put(nextRoot, committee);
        await db.checkpointHeader.put(root, header);
        const server = {
          db,
          getBootstrap: LightClientServer.prototype.getBootstrap,
          getUpdate: LightClientServer.prototype.getUpdate,
        } as unknown as LightClientServer;
        const chain = {...makeChain(db), lightClientServer: server};
        const context = new ServingContext(policy);
        expect(await Array.fromAsync(onLightClientBootstrap(root, chain, context))).toEqual(
          await Array.fromAsync(onLightClientBootstrap(root, chain))
        );
        const decoded = await server.getBootstrap(root, context);
        expect(decodedBackingBytes([decoded])).toBeLessThanOrEqual(policy.decodedBytes);
        expect((await db.syncCommitteeWitness.getBinary(root))?.[0]).toBe(
          fork === ForkName.electra || fork === ForkName.fulu ? 1 : 0
        );
        await db.syncCommittee.delete(nextRoot);
        await expect(Array.fromAsync(onLightClientBootstrap(root, chain, context))).rejects.toMatchObject({
          status: RespStatus.RESOURCE_UNAVAILABLE,
          message: expect.stringContaining("nextSyncCommittee"),
        });
        const update = types.LightClientUpdate.defaultValue();
        update.attestedHeader.beacon.slot = forkSlot;
        await db.bestLightClientUpdate.put(2, update);
        await db.bestLightClientUpdate.put(3, update);
        await db.bestLightClientUpdate.put(5, update);
        const request = {startPeriod: 0, count: 6};
        const expected = await Array.fromAsync(onLightClientUpdatesByRange(request, chain));
        const actual = await Array.fromAsync(onLightClientUpdatesByRange(request, chain, context));
        expect(actual).toEqual(expected);
        expect(actual).toHaveLength(2);
        expect((await db.bestLightClientUpdate.getBinary(2))?.length).toBe(
          8 + types.LightClientUpdate.value_serializedSize(update)
        );
      }));
  }

  it("preserves local capacity category through the light-client translation", async () =>
    withDb(async (db) => {
      // A stock read reports a local capacity refusal as the database would
      vi.spyOn(db.syncCommitteeWitness, "get").mockRejectedValue(new ServingCapacityError("database read"));
      const server = {db, getBootstrap: LightClientServer.prototype.getBootstrap} as unknown as LightClientServer;
      const chain = {...makeChain(db), lightClientServer: server};
      const budget = HostServingBudget.forEnvironment(policy);
      const handler = startServingHandler(budget, (context) => onLightClientBootstrap(root, chain, context));
      await expect(handler.next()).rejects.toMatchObject({
        status: RespStatus.SERVER_ERROR,
        code: "HOST_SERVING_CAPACITY",
      });
      await handler.retired;
      expect(budget.snapshot().occupancy).toBe(0);
    }));
});
