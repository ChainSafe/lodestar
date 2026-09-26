import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {describe, expect, it, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {LevelDbController} from "@lodestar/db";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {Logger, defer, toRootHex} from "@lodestar/utils";
import {BlockInputPreData} from "../../../../../src/chain/blocks/blockInput/blockInput.js";
import {BlockInputSource} from "../../../../../src/chain/blocks/blockInput/types.js";
import {BeaconChain} from "../../../../../src/chain/chain.js";
import {IBeaconChain} from "../../../../../src/chain/interface.js";
import {LightClientServer} from "../../../../../src/chain/lightClient/index.js";
import {ServingContext} from "../../../../../src/chain/serving/context.js";
import {BeaconDb} from "../../../../../src/db/beacon.js";
import {onBeaconBlocksByRange} from "../../../../../src/network/reqresp/handlers/beaconBlocksByRange.js";
import {onLightClientBootstrap} from "../../../../../src/network/reqresp/handlers/lightClientBootstrap.js";
import {HostServingBudget} from "../../../../../src/network/reqresp/serving/budget.js";
import {startServingHandler} from "../../../../../src/network/reqresp/serving/handler.js";
import {resolveServingPolicy} from "../../../../../src/network/reqresp/serving/policy.js";
import {SerializedCache} from "../../../../../src/util/serializedCache.js";

const config = createBeaconConfig({ALTAIR_FORK_EPOCH: 0, GLOAS_FORK_EPOCH: Infinity}, new Uint8Array(32));
const logger = {debug: vi.fn(), verbose: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn()} as unknown as Logger;
const policy = resolveServingPolicy(config, 6, 0);
const bounds = new ServingContext({...policy, sourceBytes: 1024, ancestrySteps: 1});

describe("bounded serving actual behavior", () => {
  it("keeps actual archive handler next and return retirement independent", async () => {
    const pull = defer<IteratorResult<{key: Uint8Array; value: Uint8Array}>>();
    const cleanup = defer<IteratorResult<{key: Uint8Array; value: Uint8Array}>>();
    const started = defer<void>();
    const closing = defer<void>();
    const budget = HostServingBudget.forEnvironment({...policy, capacity: 1});
    const chain = {
      config,
      logger,
      earliestAvailableSlot: 0,
      forkChoice: {getFinalizedCheckpointSlot: () => 1},
    } as unknown as IBeaconChain;
    const archive = {
      blockCertification: {isArchiveRangeVerified: () => true},
      blockArchive: {
        decodeKey: () => 0,
        binaryEntriesStream: () => ({
          [Symbol.asyncIterator]: () => ({
            next: () => {
              started.resolve();
              return pull.promise;
            },
            return: () => {
              closing.resolve();
              return cleanup.promise;
            },
          }),
        }),
      },
    };
    const handler = startServingHandler(budget, (context) =>
      Reflect.apply(onBeaconBlocksByRange, undefined, [
        {startSlot: 0, count: 1, step: 1},
        chain,
        archive,
        {toString: () => "peer"},
        "test",
        context,
      ])
    );
    const next = handler.next();
    try {
      await started.promise;
      handler.cancel();
      expect(budget.snapshot()).toMatchObject({occupancy: 1, outstandingRetirements: 1});
      pull.resolve({done: false, value: {key: new Uint8Array(9), value: new Uint8Array(8)}});
      await next;
      await closing.promise;
      expect(budget.snapshot()).toMatchObject({occupancy: 1, outstandingRetirements: 1});
    } finally {
      pull.resolve({done: true, value: undefined});
      cleanup.resolve({done: true, value: undefined});
      await next;
      await handler.retired;
    }
    expect(budget.snapshot()).toMatchObject({occupancy: 0, outstandingRetirements: 0});
  });

  it("refuses a range before any read when it reaches blocks that are not certified", async () => {
    const chain = {
      config,
      logger,
      earliestAvailableSlot: 0,
      forkChoice: {
        getFinalizedCheckpointSlot: () => 1,
        getHead: () => ({slot: 1, blockRoot: "1"}),
        getAllAncestorBlocks: () => [],
        iterateAncestorBlocks: () => [].values(),
      },
    } as unknown as IBeaconChain;
    const stream = vi.fn(() => [][Symbol.iterator]());
    const certification = {hotVerified: false, isArchiveRangeVerified: vi.fn(() => true)};
    const serve = (count: number) =>
      Array.fromAsync(
        Reflect.apply(onBeaconBlocksByRange, undefined, [
          {startSlot: 0, count, step: 1},
          chain,
          {blockCertification: certification, blockArchive: {binaryEntriesStream: stream, decodeKey: () => 0}},
          {toString: () => "peer"},
          "test",
          new ServingContext(policy),
        ])
      );
    // Slots 0 and 1 are archived and certified; slot 2 is unfinalized and this run's hot scan has not passed
    await expect(serve(3)).rejects.toMatchObject({code: "HOST_SERVING_UNAVAILABLE"});
    expect(stream).not.toHaveBeenCalled();
    await expect(serve(2)).resolves.toEqual([]);
    expect(stream).toHaveBeenCalledOnce();
    expect(certification.isArchiveRangeVerified).toHaveBeenLastCalledWith(0, 1);
    // An archived slot outside the certified interval refuses the range too
    certification.isArchiveRangeVerified.mockReturnValue(false);
    await expect(serve(1)).rejects.toMatchObject({code: "HOST_SERVING_UNAVAILABLE"});
    expect(stream).toHaveBeenCalledOnce();
  });

  it("rejects a small cached view with oversized backing", async () => {
    const block = ssz.altair.SignedBeaconBlock.defaultValue();
    const root = toRootHex(ssz.altair.BeaconBlock.hashTreeRoot(block.message));
    const input = BlockInputPreData.createFromBlock({
      block,
      blockRootHex: root,
      forkName: ForkName.altair,
      daOutOfRange: true,
      source: BlockInputSource.byRoot,
      seenTimestampSec: 0,
    });
    const cache = new SerializedCache();
    cache.set(block, new Uint8Array(2048).subarray(0, 512));
    const chain = {
      config,
      serializedCache: cache,
      seenBlockInputCache: {get: () => input},
      forkChoice: {getBlockHexDefaultStatus: () => ({blockRoot: root})},
    };
    await expect(
      Reflect.apply(BeaconChain.prototype.getSerializedBlockByRoot, chain, [root, bounds])
    ).rejects.toMatchObject({code: "HOST_SERVING_CAPACITY"});
  });

  it("rejects a real stored row over the source cap", async () => {
    const path = await mkdtemp(join(tmpdir(), "serving-red-"));
    const controller = await LevelDbController.create({name: path}, {logger});
    try {
      const db = new BeaconDb(config, controller);
      const root = new Uint8Array(32);
      await db.block.putBinary(root, new Uint8Array(2048));
      // Within MAX_PAYLOAD_SIZE, so certified, but over this context's source cap
      await db.blockCertification.load();
      expect(await db.blockCertification.scanHot()).toBeNull();
      const chain = {
        config,
        db,
        seenBlockInputCache: {get: () => undefined},
        forkChoice: {getBlockHexDefaultStatus: () => ({blockRoot: toRootHex(root)})},
      };
      await expect(
        Reflect.apply(BeaconChain.prototype.getSerializedBlockByRoot, chain, [toRootHex(root), bounds])
      ).rejects.toMatchObject({code: "HOST_SERVING_CAPACITY"});
    } finally {
      await controller.close();
      await rm(path, {recursive: true, force: true});
    }
  });

  it("rejects traversal work including newer skipped ancestors", async () => {
    const nodes = [10, 9, 8].map((slot) => ({slot, blockRoot: String(slot)}));
    const chain = {
      config,
      logger,
      earliestAvailableSlot: 0,
      forkChoice: {
        getFinalizedCheckpointSlot: () => 0,
        getHead: () => nodes[0],
        getAllAncestorBlocks: () => nodes,
        iterateAncestorBlocks: () => nodes.slice(1).values(),
      },
    } as unknown as IBeaconChain;
    const responses = Reflect.apply(onBeaconBlocksByRange, undefined, [
      {startSlot: 1, count: 1, step: 1},
      chain,
      {blockCertification: {hotVerified: true}},
      {toString: () => "peer"},
      "test",
      bounds,
    ]);
    await expect(Array.fromAsync(responses)).rejects.toMatchObject({code: "HOST_SERVING_CAPACITY"});
  });

  it("keeps cancelled bootstrap retirement pending for its rejected aggregate sibling", async () => {
    const first = defer<null>();
    const second = defer<null>();
    let calls = 0;
    const server = {
      db: {
        syncCommitteeWitness: {
          get: async () => ({currentSyncCommitteeRoot: new Uint8Array(32), nextSyncCommitteeRoot: new Uint8Array(32)}),
        },
        syncCommittee: {get: () => (++calls === 1 ? first.promise : second.promise)},
      },
    };
    const chain = {
      config,
      lightClientServer: {
        getBootstrap: (root: Uint8Array, context?: ServingContext) =>
          Reflect.apply(LightClientServer.prototype.getBootstrap, server, [root, context]),
      },
    } as unknown as IBeaconChain;
    const budget = HostServingBudget.forEnvironment(policy);
    const iterator = startServingHandler(budget, (context) =>
      onLightClientBootstrap(new Uint8Array(32), chain, context)
    );
    const next = iterator.next().catch(() => undefined);
    for (let tick = 0; tick < 16 && calls < 2; tick++) await Promise.resolve();
    expect(calls).toBe(2);
    let retired = false;
    iterator.cancel();
    const returned = iterator.retired.then(() => {
      retired = true;
    });
    first.reject(new Error("first read failed"));
    try {
      await next;
      await Promise.resolve();
      await Promise.resolve();
      expect(retired).toBe(false);
      expect(budget.snapshot()).toMatchObject({occupancy: 1, outstandingRetirements: 1});
    } finally {
      second.resolve(null);
      await returned;
      expect(budget.snapshot()).toMatchObject({occupancy: 0, outstandingRetirements: 0});
    }
  });
});
