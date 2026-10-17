import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {PeerId} from "@libp2p/interface";
import {describe, expect, it, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {LevelDbController} from "@lodestar/db";
import {PayloadStatus} from "@lodestar/fork-choice";
import {ForkName, NUMBER_OF_COLUMNS, SLOTS_PER_EPOCH} from "@lodestar/params";
import {RespStatus, ResponseOutgoing} from "@lodestar/reqresp";
import {ssz, sszTypesFor} from "@lodestar/types";
import {Logger, byteArrayEquals, defer, toRootHex} from "@lodestar/utils";
import {BlockInputColumns} from "../../../../../src/chain/blocks/blockInput/blockInput.js";
import {BlockInputSource} from "../../../../../src/chain/blocks/blockInput/types.js";
import {BeaconChain} from "../../../../../src/chain/chain.js";
import {IBeaconChain} from "../../../../../src/chain/interface.js";
import {LightClientServer} from "../../../../../src/chain/lightClient/index.js";
import {BeaconDb} from "../../../../../src/db/beacon.js";
import {onBeaconBlocksByRange} from "../../../../../src/network/reqresp/handlers/beaconBlocksByRange.js";
import {onDataColumnSidecarsByRoot} from "../../../../../src/network/reqresp/handlers/dataColumnSidecarsByRoot.js";
import {onLightClientBootstrap} from "../../../../../src/network/reqresp/handlers/lightClientBootstrap.js";
import {onLightClientUpdatesByRange} from "../../../../../src/network/reqresp/handlers/lightClientUpdatesByRange.js";
import {SerializedCache} from "../../../../../src/util/serializedCache.js";

const config = createBeaconConfig(
  {
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 1,
    CAPELLA_FORK_EPOCH: 2,
    DENEB_FORK_EPOCH: 3,
    ELECTRA_FORK_EPOCH: 4,
    FULU_FORK_EPOCH: 5,
    GLOAS_FORK_EPOCH: Infinity,
  },
  new Uint8Array(32)
);
const root = new Uint8Array(32).fill(1);
const rootHex = toRootHex(root);
const slot = 6 * SLOTS_PER_EPOCH;
const logger = {debug: vi.fn(), verbose: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn()} as unknown as Logger;
const peer = {toString: () => "peer"} as PeerId;

async function withDb(run: (db: BeaconDb, controller: LevelDbController) => Promise<void>): Promise<void> {
  const path = await mkdtemp(join(tmpdir(), "lodestar-serving-"));
  const controller = await LevelDbController.create({name: path}, {logger});
  const db = new BeaconDb(config, controller, {dataColumnDir: join(path, "columns"), logger});
  try {
    await db.init();
    await run(db, controller);
  } finally {
    await db.close();
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
function columns(chain: IBeaconChain, db: BeaconDb, indices: number[]): AsyncIterable<ResponseOutgoing> {
  return onDataColumnSidecarsByRoot([{blockRoot: root, columns: indices}], chain, db, peer, "test");
}

describe("request source reads", () => {
  it("preserves a complete duplicate/out-of-order/missing flat-file batch across writes", async () =>
    withDb(async (db) => {
      const chain = makeChain(db);
      await db.dataColumns.putManyBinary({slot, blockRoot: rootHex}, [{index: 0, data: column(0, 1)}]);
      await db.dataColumns.putManyBinary({slot, blockRoot: rootHex}, [{index: 2, data: column(2, 2)}]);
      const indices = [2, 0, 2, 1];
      const ordinary = await Array.fromAsync(columns(chain, db, indices));
      const iterator = columns(chain, db, indices)[Symbol.asyncIterator]();
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
        const archived = await Array.fromAsync(columns(chain, db, indices));
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
        (await Array.fromAsync(columns(chain, db, [0, 1]))).map(
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
      const served = await Array.fromAsync(columns(chain, db, [0, 1]));
      expect(served.map(({data}) => data)).toEqual([column(0, 3), column(1, 2)]);
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
      const iterator = onBeaconBlocksByRange(request, chain, db, peer, "test")[Symbol.asyncIterator]();
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
      const iterator = onBeaconBlocksByRange({startSlot: 0, count: 4, step: 1}, customChain, db, peer, "test")[
        Symbol.asyncIterator
      ]();
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
        const [bootstrap] = await Array.fromAsync(onLightClientBootstrap(root, chain));
        expect(types.LightClientBootstrap.deserialize(bootstrap.data)).toEqual(await server.getBootstrap(root));
        expect((await db.syncCommitteeWitness.getBinary(root))?.[0]).toBe(
          fork === ForkName.electra || fork === ForkName.fulu ? 1 : 0
        );
        await db.syncCommittee.delete(nextRoot);
        await expect(Array.fromAsync(onLightClientBootstrap(root, chain))).rejects.toMatchObject({
          status: RespStatus.RESOURCE_UNAVAILABLE,
          message: expect.stringContaining("nextSyncCommittee"),
        });
        const update = types.LightClientUpdate.defaultValue();
        update.attestedHeader.beacon.slot = forkSlot;
        await db.bestLightClientUpdate.put(2, update);
        await db.bestLightClientUpdate.put(3, update);
        await db.bestLightClientUpdate.put(5, update);
        const request = {startPeriod: 0, count: 6};
        const actual = await Array.fromAsync(onLightClientUpdatesByRange(request, chain));
        expect(actual).toHaveLength(2);
        for (const response of actual) expect(types.LightClientUpdate.deserialize(response.data)).toEqual(update);
        expect((await db.bestLightClientUpdate.getBinary(2))?.length).toBe(
          8 + types.LightClientUpdate.value_serializedSize(update)
        );
      }));
  }
});
