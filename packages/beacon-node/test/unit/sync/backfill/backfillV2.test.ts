import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {config} from "@lodestar/config/default";
import {testLogger} from "@lodestar/logger/test-utils";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {phase0, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BackfilledRangeWrapper} from "../../../../src/db/single/backfilledRange.js";
import {INetwork, NetworkEvent, NetworkEventBus} from "../../../../src/network/index.js";
import {BackfillSync, BackfillSyncEvent} from "../../../../src/sync/backfill/backfillV2.js";
import {MockedBeaconChain, getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";
import {MockedBeaconDb, getMockedBeaconDb} from "../../../mocks/mockedBeaconDb.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("sync / backfill / backfillV2", () => {
  const beaconConfig = createBeaconConfig(config, ssz.Root.defaultValue());
  const logger = testLogger();

  let chain: MockedBeaconChain;
  let db: MockedBeaconDb;
  let controller: AbortController;

  beforeEach(() => {
    chain = getMockedBeaconChain({config: beaconConfig});
    db = getMockedBeaconDb();
    controller = new AbortController();

    // BackfilledRange is not auto-mocked by `mockedBeaconDb`;
    let currentRange: BackfilledRangeWrapper | null = null;
    db.backfilledRange.get = vi.fn(async () => currentRange);
    db.backfilledRange.put = vi.fn(async (val) => {
      currentRange = val;
    });
    db.backfilledRange.delete = vi.fn(async () => {
      currentRange = null;
    });

    db.backfillState.get.mockResolvedValue(null);
    db.backfillState.put.mockResolvedValue(undefined);
    db.blockArchive.batchPut.mockResolvedValue(undefined);
    db.blockArchive.values.mockResolvedValue([]);
    // No cached blocks — every fetch goes through the network path in tests.
    db.blockArchive.getByRoot.mockResolvedValue(null);
    db.blockArchive.getSlotByRoot.mockResolvedValue(null);
  });

  afterEach(() => {
    controller.abort();
    vi.clearAllMocks();
  });

  it("should walk the chain by-root using mainnet fixture blocks", {timeout: 10_000}, async () => {
    const chainBlocks = getBlocks();
    const {networkEvents, fetchedRoots, walkedPastFixture} = await initSyncFromChain(chainBlocks, {
      onMissingRoot: "abort",
    });

    if (!walkedPastFixture) throw new Error("walkedPastFixture not set");

    connectPeer(networkEvents);

    await withTimeout(walkedPastFixture, 5_000, "backfill chain walk");

    const expectedRoots = chainBlocks
      .slice()
      .reverse()
      .map((b) => toRootHex(ssz.phase0.BeaconBlock.hashTreeRoot(b.message)));
    expect(fetchedRoots.slice(0, chainBlocks.length)).toEqual(expectedRoots);
    expect(fetchedRoots.length).toBeGreaterThanOrEqual(chainBlocks.length + 1);
    expect(db.backfilledRange.put).toHaveBeenCalled();
  });

  it("should flush all blocks and complete at genesis", {timeout: 10_000}, async () => {
    const chainBlocks = generateLinearChain(0, 3);
    const {backfillSync, networkEvents} = await initSyncFromChain(chainBlocks);

    const completed = new Promise<void>((resolve) => {
      backfillSync.on(BackfillSyncEvent.completed, () => resolve());
    });

    connectPeer(networkEvents);

    await withTimeout(completed, 5_000, "backfill completion at genesis");

    const flushed = db.blockArchive.batchPut.mock.calls.flatMap((call) => call[0]);
    expect(flushed).toHaveLength(3);
    expect(flushed.map((p: {key: number}) => p.key).sort((a: number, b: number) => a - b)).toEqual([0, 1, 2]);
    expect(db.backfillState.put).toHaveBeenCalledWith(0, expect.objectContaining({hasBlock: true}));
  });

  it("should flush at epoch boundary when walking backward", {timeout: 10_000}, async () => {
    // Slots 30,31 (epoch 0) and 32,33 (epoch 1). Walk: 33→32→31→30, then anchorRoot is ZERO_HASH and sync completes.
    const chainBlocks = generateLinearChain(30, 4);
    const {backfillSync, networkEvents} = await initSyncFromChain(chainBlocks);

    const completed = new Promise<void>((resolve) => {
      backfillSync.on(BackfillSyncEvent.completed, () => resolve());
    });

    connectPeer(networkEvents);

    await withTimeout(completed, 5_000, "backfill epoch boundary flush");

    // Epoch 1 (slots 32,33) should have been flushed when we crossed into epoch 0
    expect(db.backfillState.put).toHaveBeenCalledWith(1, expect.objectContaining({hasBlock: true}));

    const flushed = db.blockArchive.batchPut.mock.calls.flatMap((call) => call[0]);
    const epoch1Flushed = flushed.filter((p: {key: number}) => p.key >= 32);
    expect(epoch1Flushed).toHaveLength(2);
  });

  it("should flush correctly with skipped slot at epoch boundary", {timeout: 10_000}, async () => {
    // Slots 30,31,33 (slot 32 skipped). Walk: 33→31→30, then anchorRoot is ZERO_HASH and sync completes.
    // Without the buffer-epoch fix, epoch 1 (slot 33) and epoch 0 (slot 31) would mix in the buffer.
    const blocks = generateLinearChainWithSlots([30, 31, 33]);
    const {backfillSync, networkEvents} = await initSyncFromChain(blocks);

    const completed = new Promise<void>((resolve) => {
      backfillSync.on(BackfillSyncEvent.completed, () => resolve());
    });

    connectPeer(networkEvents);

    await withTimeout(completed, 5_000, "backfill skipped-slot boundary");

    // Epoch 1 flush should contain only slot 33 (not mixed with epoch 0)
    expect(db.backfillState.put).toHaveBeenCalledWith(1, expect.objectContaining({hasBlock: true}));

    const firstFlush = db.blockArchive.batchPut.mock.calls[0]?.[0] ?? [];
    expect(firstFlush).toHaveLength(1);
    expect(firstFlush[0].key).toBe(33);
  });

  it("should batch the block_roots window then walk older blocks serially", {timeout: 10_000}, async () => {
    // Blocks at slots 0,1,2 then a large gap up to 9000,9001,9002. With anchorState.slot = 9003
    // the block_roots window floor is 9003 - SLOTS_PER_HISTORICAL_ROOT (8192) = 811, so blocks
    // 9000-9002 (plus the window-floor entry, which resolves to block 2) are fetched in a Phase 1
    // batch, while blocks 1 and 0 sit below the window and are walked one-by-one in Phase 2.
    const chainBlocks = generateLinearChainWithSlots([0, 1, 2, 9000, 9001, 9002]);
    const {backfillSync, networkEvents, sendByRoot} = await initSyncFromChain(chainBlocks, {stateSlot: 9003});

    const completed = new Promise<void>((resolve) => {
      backfillSync.on(BackfillSyncEvent.completed, () => resolve());
    });

    connectPeer(networkEvents);
    await withTimeout(completed, 5_000, "backfill two-phase completion");

    // Phase 1 issues a multi-root batch first; Phase 2 then issues single-root requests.
    const callSizes = sendByRoot.mock.calls.map((c) => Array.from(c[1] as Iterable<unknown>).length);
    expect(callSizes[0]).toBeGreaterThan(1);
    expect(callSizes.at(-1)).toBe(1);

    const flushed = db.blockArchive.batchPut.mock.calls.flatMap((call) => call[0]);
    expect(flushed.map((p: {key: number}) => p.key).sort((a: number, b: number) => a - b)).toEqual([
      0, 1, 2, 9000, 9001, 9002,
    ]);
  });

  it("should short-circuit via the DB cache when blocks are already stored", {timeout: 5_000}, async () => {
    // Every block is pre-cached in blockArchive — Phase 1's pre-filter drops the whole
    // known-roots window, and Phase 2 walks via the cache short-circuit all the way to
    // genesis without a single network call.
    const chainBlocks = generateLinearChain(0, 3);
    const cachedRoots = indexBlocksByRoot(chainBlocks);
    const {backfillSync, networkEvents, sendByRoot} = await initSyncFromChain(chainBlocks, {cachedRoots});

    const completed = new Promise<void>((resolve) => {
      backfillSync.on(BackfillSyncEvent.completed, () => resolve());
    });

    connectPeer(networkEvents);
    await withTimeout(completed, 4_000, "cache short-circuit completion");

    expect(sendByRoot.mock.calls.length).toBe(0);
  });

  it("should complete despite peers that cannot serve the requested blocks", {timeout: 10_000}, async () => {
    // Three peers are connected but two of them serve nothing. The Phase 2 hedged fetch must
    // fan out past the dead peers, and Phase 1 must retry past them, so the whole chain still
    // gets backfilled via the single peer that has the blocks.
    const chainBlocks = generateLinearChainWithSlots([0, 1, 2, 9000, 9001, 9002]);
    const {backfillSync, networkEvents} = await initSyncFromChain(chainBlocks, {
      stateSlot: 9003,
      badPeers: new Set(["bad-peer-1", "bad-peer-2"]),
    });

    const completed = new Promise<void>((resolve) => {
      backfillSync.on(BackfillSyncEvent.completed, () => resolve());
    });

    connectPeers(networkEvents, ["bad-peer-1", "good-peer", "bad-peer-2"]);
    await withTimeout(completed, 8_000, "backfill hedged completion");

    const flushed = db.blockArchive.batchPut.mock.calls.flatMap((call) => call[0]);
    expect(flushed.map((p: {key: number}) => p.key).sort((a: number, b: number) => a - b)).toEqual([
      0, 1, 2, 9000, 9001, 9002,
    ]);
  });

  function generateLinearChain(startSlot: number, count: number): phase0.SignedBeaconBlock[] {
    const slots = Array.from({length: count}, (_, i) => startSlot + i);
    return generateLinearChainWithSlots(slots);
  }

  function generateLinearChainWithSlots(slots: number[]): phase0.SignedBeaconBlock[] {
    const blocks: phase0.SignedBeaconBlock[] = [];
    let parentRoot: Uint8Array = new Uint8Array(32);
    for (const slot of slots) {
      const block = ssz.phase0.SignedBeaconBlock.defaultValue();
      block.message.slot = slot;
      block.message.parentRoot = parentRoot;
      blocks.push(block);
      parentRoot = Uint8Array.from(ssz.phase0.BeaconBlock.hashTreeRoot(block.message));
    }
    return blocks;
  }

  function getBlocks(): phase0.SignedBeaconBlock[] {
    const json = JSON.parse(fs.readFileSync(path.join(__dirname, "./blocks.json"), "utf-8")) as unknown[];
    return json.map((b) => ssz.phase0.SignedBeaconBlock.fromJson(b));
  }

  function indexBlocksByRoot(blocks: phase0.SignedBeaconBlock[]): Map<string, phase0.SignedBeaconBlock> {
    const map = new Map<string, phase0.SignedBeaconBlock>();
    for (const block of blocks) {
      map.set(toRootHex(ssz.phase0.BeaconBlock.hashTreeRoot(block.message)), block);
    }
    return map;
  }

  type InitResult = {
    backfillSync: BackfillSync;
    networkEvents: NetworkEventBus;
    fetchedRoots: string[];
    sendByRoot: ReturnType<typeof vi.fn>;
    walkedPastFixture?: Promise<void>;
  };

  async function initSyncFromChain(
    chainBlocks: phase0.SignedBeaconBlock[],
    opts?: {
      onMissingRoot?: "abort";
      stateSlot?: number;
      badPeers?: Set<string>;
      cachedRoots?: Map<string, phase0.SignedBeaconBlock>;
    }
  ): Promise<InitResult> {
    const blocksByRoot = indexBlocksByRoot(chainBlocks);
    // biome-ignore lint/style/noNonNullAssertion: chain always has blocks
    const tip = chainBlocks.at(-1)!;
    const anchorRoot = ssz.phase0.BeaconBlock.hashTreeRoot(tip.message);
    const anchorSlot = tip.message.slot;

    // Mirror BeaconState.block_roots: ascending (slot, root) pairs so the anchor-state mock
    // can answer getBlockRootAtSlot() with the most recent block at or before a given slot.
    const sortedRoots = chainBlocks
      .map((b) => ({slot: b.message.slot, root: ssz.phase0.BeaconBlock.hashTreeRoot(b.message)}))
      .sort((a, b) => a.slot - b.slot);
    const stateSlot = opts?.stateSlot ?? anchorSlot + 1;
    function getBlockRootAtSlot(slot: number): Uint8Array {
      let result = sortedRoots[0].root;
      for (const entry of sortedRoots) {
        if (entry.slot > slot) break;
        result = entry.root;
      }
      return result;
    }

    let onWalkedPastFixture: (() => void) | undefined;
    let walkedPastFixture: Promise<void> | undefined;
    if (opts?.onMissingRoot === "abort") {
      walkedPastFixture = new Promise<void>((resolve) => {
        onWalkedPastFixture = () => {
          onWalkedPastFixture = undefined;
          resolve();
          controller.abort();
        };
      });
    }

    const fetchedRoots: string[] = [];
    const networkEvents = new NetworkEventBus();

    const sendByRoot = vi.fn(async (peerId: unknown, roots: Iterable<Uint8Array>) => {
      const out: phase0.SignedBeaconBlock[] = [];
      // A "bad" peer is reachable but serves no blocks (mirrors a peer that pruned history).
      if (opts?.badPeers?.has(String(peerId))) {
        return out;
      }
      for (const root of roots) {
        const hex = toRootHex(root);
        fetchedRoots.push(hex);
        const block = blocksByRoot.get(hex);
        if (block) {
          out.push(block);
        } else {
          onWalkedPastFixture?.();
        }
      }
      return out;
    });

    const network: Partial<INetwork> = {
      events: networkEvents,
      sendBeaconBlocksByRoot: sendByRoot,
      reportPeer: () => {},
    };

    if (opts?.cachedRoots) {
      const cached = opts.cachedRoots;
      db.blockArchive.getByRoot = vi.fn(async (root: Uint8Array) => cached.get(toRootHex(root)) ?? null);
      db.blockArchive.getSlotByRoot = vi.fn(async (root: Uint8Array) => {
        const block = cached.get(toRootHex(root));
        return block ? block.message.slot : null;
      });
    }

    const anchorState = {
      slot: stateSlot,
      latestBlockHeader: {slot: anchorSlot} as phase0.BeaconBlockHeader,
      getBlockRootAtSlot,
      computeAnchorCheckpoint: () => ({
        checkpoint: {epoch: computeEpochAtSlot(anchorSlot), root: anchorRoot},
        blockHeader: {slot: anchorSlot} as phase0.BeaconBlockHeader,
      }),
    };

    const backfillSync = await BackfillSync.init(
      {backfillBatchSize: 64, backfillToGenesis: true},
      {
        chain,
        db,
        network: network as INetwork,
        config: beaconConfig,
        logger,
        metrics: null,
        anchorState: anchorState as any,
        signal: controller.signal,
      }
    );

    return {backfillSync, networkEvents, fetchedRoots, sendByRoot, walkedPastFixture};
  }

  function connectPeer(networkEvents: NetworkEventBus): void {
    connectPeers(networkEvents, ["test-peer"]);
  }

  function connectPeers(networkEvents: NetworkEventBus, peerIds: string[]): void {
    for (const peer of peerIds) {
      networkEvents.emit(NetworkEvent.peerConnected, {
        peer,
        status: {} as any,
        custodyColumns: [],
        clientAgent: "test-client",
      });
    }
  }

  function withTimeout(promise: Promise<void>, ms: number, label: string): Promise<void> {
    return Promise.race([
      promise,
      new Promise<void>((_, reject) => setTimeout(() => reject(new Error(`Timed out: ${label}`)), ms)),
    ]);
  }
});
