import {beforeEach, describe, expect, it, vi} from "vitest";
import {ExecutionStatus, IForkChoice, PayloadStatus, ProtoBlock} from "@lodestar/fork-choice";
import {testLogger} from "@lodestar/logger/test-utils";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {RootHex} from "@lodestar/types";
import {PayloadEnvelopeInputSource} from "../../../../src/chain/blocks/payloadEnvelopeInput/index.js";
import {ChainEventEmitter} from "../../../../src/chain/emitter.js";
import {SeenBlockInput} from "../../../../src/chain/seenCache/seenGossipBlockInput.js";
import {SeenPayloadEnvelopeInput} from "../../../../src/chain/seenCache/seenPayloadEnvelopeInput.js";
import {IBeaconDb} from "../../../../src/db/index.js";
import {MAX_LOOK_AHEAD_EPOCHS} from "../../../../src/sync/constants.js";
import {CustodyConfig} from "../../../../src/util/dataColumns.js";
import {SerializedCache} from "../../../../src/util/serializedCache.js";
import {getMockedClock} from "../../../mocks/clock.js";
import {
  FULU_FORK_EPOCH,
  GLOAS_FORK_EPOCH,
  config,
  generateBlock,
  generateBlockWithColumnSidecars,
} from "../../../utils/blocksAndData.js";

const GLOAS_SLOT = GLOAS_FORK_EPOCH * SLOTS_PER_EPOCH;
const FULU_SLOT = FULU_FORK_EPOCH * SLOTS_PER_EPOCH;

describe("SeenPayloadEnvelopeInput", () => {
  let cache: SeenPayloadEnvelopeInput;
  let abortController: AbortController;
  let chainEvents: ChainEventEmitter;
  let forkChoice: IForkChoice;
  let serializedCache: SerializedCache;
  let db: IBeaconDb;
  let seenBlockInputCache: SeenBlockInput;

  beforeEach(() => {
    chainEvents = new ChainEventEmitter();
    abortController = new AbortController();
    forkChoice = {
      getAllAncestorBlocks: vi.fn(),
      hasBlockHex: vi.fn(),
    } as unknown as IForkChoice;
    serializedCache = new SerializedCache();
    db = {block: {get: vi.fn()}} as unknown as IBeaconDb;
    // Default: cache miss so getOrReload exercises the db path; individual tests override get().
    seenBlockInputCache = {get: vi.fn().mockReturnValue(undefined)} as unknown as SeenBlockInput;

    cache = new SeenPayloadEnvelopeInput({
      config,
      clock: getMockedClock(),
      forkChoice,
      chainEvents,
      signal: abortController.signal,
      serializedCache,
      db,
      seenBlockInputCache,
      custodyConfig: {sampledColumns: [], custodyColumns: []} as unknown as CustodyConfig,
      metrics: null,
      logger: testLogger(),
    });
  });

  function addPayloadInput(slot: number): string {
    const {block, rootHex} = generateBlock({forkName: ForkName.gloas, slot});
    cache.add({
      blockRootHex: rootHex,
      block,
      forkName: ForkName.gloas,
      sampledColumns: [],
      custodyColumns: [],
      seenTimestampSec: Date.now() / 1000,
      source: PayloadEnvelopeInputSource.gossip,
    });
    return rootHex;
  }

  // Block with blob commitments + non-empty sampledColumns and no columns added, so the input
  // reports hasComputedAllData() === false.
  function addPayloadInputNotComputed(slot: number): string {
    const {block, rootHex} = generateBlockWithColumnSidecars({forkName: ForkName.gloas, slot});
    cache.add({
      blockRootHex: rootHex,
      block,
      forkName: ForkName.gloas,
      sampledColumns: [0, 1],
      custodyColumns: [0, 1],
      seenTimestampSec: Date.now() / 1000,
      source: PayloadEnvelopeInputSource.gossip,
    });
    return rootHex;
  }

  function protoBlock(blockRoot: RootHex, slot: number): ProtoBlock {
    return {
      slot,
      blockRoot,
      parentRoot: blockRoot,
      stateRoot: blockRoot,
      targetRoot: blockRoot,
      justifiedEpoch: 0,
      justifiedRoot: blockRoot,
      finalizedEpoch: 0,
      finalizedRoot: blockRoot,
      unrealizedJustifiedEpoch: 0,
      unrealizedJustifiedRoot: blockRoot,
      unrealizedFinalizedEpoch: 0,
      unrealizedFinalizedRoot: blockRoot,
      timeliness: false,
      executionPayloadBlockHash: null,
      executionStatus: ExecutionStatus.PreMerge,
      dataAvailabilityStatus: DataAvailabilityStatus.PreData,
      payloadStatus: PayloadStatus.FULL,
      parentBlockHash: null,
    };
  }

  it("pruneBelowParent removes ancestor payload inputs below the parent slot", () => {
    const oldRootHex = addPayloadInput(1);
    const newRootHex = addPayloadInput(2);
    const parentBlock = protoBlock(newRootHex, 2);

    vi.mocked(forkChoice.getAllAncestorBlocks).mockReturnValue([parentBlock, protoBlock(oldRootHex, 1)]);
    cache.pruneBelowParent(parentBlock);

    expect(cache.get(oldRootHex)).toBeUndefined();
    expect(cache.get(newRootHex)).toBeDefined();
  });

  it("pruneBelowParent keeps ancestor payload inputs whose payload is not yet FULL", () => {
    const oldRootHex = addPayloadInput(1);
    const newRootHex = addPayloadInput(2);
    const parentBlock = protoBlock(newRootHex, 2);
    const emptyAncestor: ProtoBlock = {...protoBlock(oldRootHex, 1), payloadStatus: PayloadStatus.EMPTY};

    vi.mocked(forkChoice.getAllAncestorBlocks).mockReturnValue([parentBlock, emptyAncestor]);
    cache.pruneBelowParent(parentBlock);

    expect(cache.get(oldRootHex)).toBeDefined();
  });

  it("pruneBelowParent keeps ancestor payload inputs that have not computed all data", () => {
    const oldRootHex = addPayloadInputNotComputed(1);
    const newRootHex = addPayloadInput(2);
    // precondition: the ancestor input is still gathering columns
    expect(cache.get(oldRootHex)?.hasComputedAllData()).toBe(false);

    const parentBlock = protoBlock(newRootHex, 2);
    vi.mocked(forkChoice.getAllAncestorBlocks).mockReturnValue([parentBlock, protoBlock(oldRootHex, 1)]);
    cache.pruneBelowParent(parentBlock);

    expect(cache.get(oldRootHex)).toBeDefined();
  });

  it("pruneBelowParent keeps payload inputs at the parent slot", () => {
    const rootHex = addPayloadInput(1);
    const parentBlock = protoBlock(rootHex, 1);

    vi.mocked(forkChoice.getAllAncestorBlocks).mockReturnValue([parentBlock]);
    cache.pruneBelowParent(parentBlock);

    expect(cache.get(rootHex)).toBeDefined();
  });

  it("add returns the existing entry on duplicate root", () => {
    const {block, rootHex} = generateBlock({forkName: ForkName.gloas, slot: 1});
    const props = {
      blockRootHex: rootHex,
      block,
      forkName: ForkName.gloas,
      sampledColumns: [],
      custodyColumns: [],
      seenTimestampSec: Date.now() / 1000,
      source: PayloadEnvelopeInputSource.gossip,
    };

    const first = cache.add(props);
    const second = cache.add(props);

    expect(second).toBe(first);
    expect(cache.size()).toBe(1);
  });

  it("prune removes a single entry by root and leaves others", () => {
    const rootHex1 = addPayloadInput(1);
    const rootHex2 = addPayloadInput(2);

    cache.prune(rootHex1);

    expect(cache.get(rootHex1)).toBeUndefined();
    expect(cache.get(rootHex2)).toBeDefined();
    expect(cache.size()).toBe(1);
  });

  it("prune is a no-op for an unknown root", () => {
    const rootHex = addPayloadInput(1);

    expect(() => cache.prune(`0x${"ab".repeat(32)}`)).not.toThrow();
    expect(cache.get(rootHex)).toBeDefined();
    expect(cache.size()).toBe(1);
  });

  describe("getOrReload", () => {
    it("returns the in-memory entry without touching fork choice or db", async () => {
      const rootHex = addPayloadInput(1);

      const result = await cache.getOrReload(rootHex);

      expect(result).toBe(cache.get(rootHex));
      expect(forkChoice.hasBlockHex).not.toHaveBeenCalled();
      expect(db.block.get).not.toHaveBeenCalled();
    });

    it("returns undefined and does not read db when the block is not in fork choice", async () => {
      vi.mocked(forkChoice.hasBlockHex).mockReturnValue(false);

      const result = await cache.getOrReload(`0x${"ab".repeat(32)}`);

      expect(result).toBeUndefined();
      expect(db.block.get).not.toHaveBeenCalled();
    });

    it("reconstructs an EMPTY PayloadEnvelopeInput from the hot db when the gloas block is in fork choice", async () => {
      const {block, rootHex} = generateBlock({forkName: ForkName.gloas, slot: GLOAS_SLOT});
      vi.mocked(forkChoice.hasBlockHex).mockReturnValue(true);
      vi.mocked(db.block.get).mockResolvedValue(block);

      const result = await cache.getOrReload(rootHex);

      expect(result).toBeDefined();
      expect(result?.slot).toBe(GLOAS_SLOT);
      // inserted into the cache so subsequent sync get() hits
      expect(cache.get(rootHex)).toBe(result);
    });

    it("reconstructs from seenBlockInputCache without reading db when the block is still in memory", async () => {
      const {block, rootHex} = generateBlock({forkName: ForkName.gloas, slot: GLOAS_SLOT});
      vi.mocked(forkChoice.hasBlockHex).mockReturnValue(true);
      // Block imported but its async db write has not flushed yet: it is still in seenBlockInputCache.
      vi.mocked(seenBlockInputCache.get).mockReturnValue({
        hasBlock: () => true,
        getBlock: () => block,
      } as unknown as ReturnType<SeenBlockInput["get"]>);

      const result = await cache.getOrReload(rootHex);

      expect(result).toBeDefined();
      expect(result?.slot).toBe(GLOAS_SLOT);
      expect(cache.get(rootHex)).toBe(result);
      // in-memory hit avoids the disk read
      expect(db.block.get).not.toHaveBeenCalled();
    });

    it("returns undefined during the import-to-persist window (block not yet in hot db)", async () => {
      vi.mocked(forkChoice.hasBlockHex).mockReturnValue(true);
      vi.mocked(db.block.get).mockResolvedValue(null);

      const result = await cache.getOrReload(`0x${"cd".repeat(32)}`);

      expect(result).toBeUndefined();
      expect(cache.size()).toBe(0);
    });

    it("returns undefined for a pre-gloas block", async () => {
      const {block, rootHex} = generateBlock({forkName: ForkName.fulu, slot: FULU_SLOT});
      vi.mocked(forkChoice.hasBlockHex).mockReturnValue(true);
      vi.mocked(db.block.get).mockResolvedValue(block);

      const result = await cache.getOrReload(rootHex);

      expect(result).toBeUndefined();
      expect(cache.get(rootHex)).toBeUndefined();
    });

    it("dedups concurrent reloads of the same root into a single db read and object", async () => {
      const {block, rootHex} = generateBlock({forkName: ForkName.gloas, slot: GLOAS_SLOT});
      vi.mocked(forkChoice.hasBlockHex).mockReturnValue(true);
      vi.mocked(db.block.get).mockResolvedValue(block);

      const [a, b] = await Promise.all([cache.getOrReload(rootHex), cache.getOrReload(rootHex)]);

      // Without in-flight dedup, each miss would build a divergent shell that the import-path
      // WeakMap cannot dedup on object identity.
      expect(a).toBe(b);
      expect(db.block.get).toHaveBeenCalledTimes(1);
    });
  });

  describe("pruneToMaxSize (insertion-order cap)", () => {
    const MAX = (MAX_LOOK_AHEAD_EPOCHS + 1) * SLOTS_PER_EPOCH;

    it("caps size and evicts by insertion order, not slot order", () => {
      // Insert MAX + 2 entries in DESCENDING slot order, so insertion order != slot order.
      const rootsInInsertionOrder: string[] = [];
      for (let i = MAX + 1; i >= 0; i--) {
        rootsInInsertionOrder.push(addPayloadInput(GLOAS_SLOT + i));
      }

      expect(cache.size()).toBe(MAX);
      // The 2 first-inserted (highest slots) are evicted; a slot-ordered cap would have evicted the
      // lowest slots instead.
      expect(cache.get(rootsInInsertionOrder[0])).toBeUndefined();
      expect(cache.get(rootsInInsertionOrder[1])).toBeUndefined();
      // Everything inserted afterwards (including the lowest slots) survives.
      expect(cache.get(rootsInInsertionOrder[2])).toBeDefined();
      expect(cache.get(rootsInInsertionOrder.at(-1) as string)).toBeDefined();
    });

    it("keeps a just-reloaded old-slot entry, evicting an older-inserted one instead", async () => {
      // Fill exactly to MAX with high slots.
      const firstInserted = addPayloadInput(GLOAS_SLOT + MAX);
      for (let i = MAX - 1; i >= 1; i--) {
        addPayloadInput(GLOAS_SLOT + i);
      }
      expect(cache.size()).toBe(MAX);

      // getOrReload an old-slot miss: it inserts the reconstructed shell at the BACK, then the cap runs.
      const {block, rootHex} = generateBlock({forkName: ForkName.gloas, slot: GLOAS_SLOT});
      vi.mocked(forkChoice.hasBlockHex).mockReturnValue(true);
      vi.mocked(db.block.get).mockResolvedValue(block);
      const reloaded = await cache.getOrReload(rootHex);

      expect(reloaded).toBeDefined();
      expect(cache.size()).toBe(MAX);
      // Anti-thrash: the reloaded old-slot entry survives; the oldest-INSERTED entry was evicted instead.
      expect(cache.get(rootHex)).toBe(reloaded);
      expect(cache.get(firstInserted)).toBeUndefined();
    });

    it("increments pruned{reason:cap} on a cap eviction", () => {
      const prunedInc = vi.fn();
      const metrics = {
        seenCache: {
          payloadEnvelopeInput: {
            count: {addCollect: vi.fn(), set: vi.fn()},
            serializedObjectRefs: {set: vi.fn()},
            created: {inc: vi.fn()},
            pruned: {inc: prunedInc},
          },
        },
      };
      const cacheWithMetrics = new SeenPayloadEnvelopeInput({
        config,
        clock: getMockedClock(),
        forkChoice,
        chainEvents,
        signal: abortController.signal,
        serializedCache: new SerializedCache(),
        db,
        seenBlockInputCache,
        custodyConfig: {sampledColumns: [], custodyColumns: []} as unknown as CustodyConfig,
        metrics: metrics as unknown as ConstructorParameters<typeof SeenPayloadEnvelopeInput>[0]["metrics"],
        logger: testLogger(),
      });

      for (let i = MAX; i >= 0; i--) {
        const {block, rootHex} = generateBlock({forkName: ForkName.gloas, slot: GLOAS_SLOT + i});
        cacheWithMetrics.add({
          blockRootHex: rootHex,
          block,
          forkName: ForkName.gloas,
          sampledColumns: [],
          custodyColumns: [],
          seenTimestampSec: Date.now() / 1000,
          source: PayloadEnvelopeInputSource.gossip,
        });
      }

      expect(cacheWithMetrics.size()).toBe(MAX);
      expect(prunedInc).toHaveBeenCalledWith({reason: "cap"});
    });
  });
});
