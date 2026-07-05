import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {ForkSeq} from "@lodestar/params";
import {NetworkEvent, NetworkEventBus} from "../../../src/network/events.js";
import {SyncState, syncStateMetric} from "../../../src/sync/interface.js";
import {BeaconSync} from "../../../src/sync/sync.js";

// ---------------------------------------------------------------------------
// Mock the three sub-sync classes so we can observe which ones BeaconSync
// constructs (the load-bearing F3 gate) and assert lifecycle wiring — without
// running any of the real sync machinery.
// ---------------------------------------------------------------------------

vi.mock("../../../src/sync/range/range.js", async (importActual) => {
  const mod = await importActual<typeof import("../../../src/sync/range/range.js")>();
  class RangeSync {
    on = vi.fn();
    off = vi.fn();
    close = vi.fn();
    addPeer = vi.fn();
    removePeer = vi.fn();
    getSyncChainsDebugState = vi.fn(() => []);
    state = {status: mod.RangeSyncStatus.Idle};
  }
  return {...mod, RangeSync: vi.fn(RangeSync)};
});

vi.mock("../../../src/sync/unknownBlock.js", async (importActual) => {
  const mod = await importActual<typeof import("../../../src/sync/unknownBlock.js")>();
  class BlockInputSync {
    close = vi.fn();
    subscribeToNetwork = vi.fn();
    unsubscribeFromNetwork = vi.fn();
    isSubscribedToNetwork = vi.fn(() => false);
  }
  return {...mod, BlockInputSync: vi.fn(BlockInputSync)};
});

vi.mock("../../../src/sync/target/targetSync.js", async (importActual) => {
  const mod = await importActual<typeof import("../../../src/sync/target/targetSync.js")>();
  class TargetSync {
    start = vi.fn();
    stop = vi.fn();
    // F4: read-only registry progress accessors consumed by BeaconSync.state /
    // scrapeMetrics. Default: no active chains, not finalized-syncing. Tests override per-case.
    activeChainCount = 0;
    isSyncingFinalized = false;
  }
  return {...mod, TargetSync: vi.fn(TargetSync)};
});

const {RangeSync} = await import("../../../src/sync/range/range.js");
const {BlockInputSync} = await import("../../../src/sync/unknownBlock.js");
const {TargetSync} = await import("../../../src/sync/target/targetSync.js");

function makeModules(
  forkSeq: ForkSeq,
  {
    currentSlot = 100,
    currentEpoch = 0,
    headSlot = 0,
    isSubscribedToGossipCoreTopics = false,
  }: {currentSlot?: number; currentEpoch?: number; headSlot?: number; isSubscribedToGossipCoreTopics?: boolean} = {}
) {
  const networkEvents = new NetworkEventBus();
  const network = {
    events: networkEvents,
    getConnectedPeerCount: vi.fn(() => 1),
    isSubscribedToGossipCoreTopics: vi.fn(() => isSubscribedToGossipCoreTopics),
    subscribeGossipCoreTopics: vi.fn().mockResolvedValue(undefined),
    unsubscribeGossipCoreTopics: vi.fn().mockResolvedValue(undefined),
  } as any;

  const clockHandlers = new Map<string, ((...args: unknown[]) => void)[]>();
  const clock = {
    currentSlot,
    currentEpoch,
    on: vi.fn((ev: string, fn: () => void) => {
      const arr = clockHandlers.get(ev) ?? [];
      arr.push(fn);
      clockHandlers.set(ev, arr);
    }),
    off: vi.fn(),
  };

  const chain = {
    config: {getForkSeq: vi.fn(() => forkSeq)},
    clock,
    forkChoice: {getHead: vi.fn(() => ({slot: headSlot}))},
    emitter: {on: vi.fn(), off: vi.fn()},
  } as any;

  // Per-target block spill repository passed to TargetSync. truncateAll backs the
  // unconditional boot wipe [A1] fired from the BeaconSync constructor.
  const targetSyncBlocks = {TARGET_SYNC_BLOCKS: true, truncateAll: vi.fn().mockResolvedValue(0)} as any;
  const db = {targetSyncBlocks} as any;

  const config = {} as any;
  const logger = {debug: vi.fn(), verbose: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()} as any;
  const metrics = null;

  return {config, chain, network, db, logger, metrics, targetSyncBlocks, clockHandlers};
}

describe("BeaconSync — TargetSync construction gate (F3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // (1) OFF: opts.targetSync falsy → RangeSync + BlockInputSync, no TargetSync
  it("flag off → constructs RangeSync + BlockInputSync, no TargetSync", () => {
    const modules = makeModules(ForkSeq.fulu);
    const sync = new BeaconSync({} as any, modules);

    expect(RangeSync).toHaveBeenCalledTimes(1);
    expect(BlockInputSync).toHaveBeenCalledTimes(1);
    expect(TargetSync).not.toHaveBeenCalled();

    expect((sync as any).rangeSync).toBeDefined();
    expect((sync as any).unknownBlockSync).toBeDefined();
    expect((sync as any).targetSync).toBeUndefined();
  });

  // (2) ON + fulu+: targetSync true & fork >= fulu → TargetSync (+ start), no Range/UnknownBlock
  it("flag on + fork >= fulu → constructs TargetSync and calls start(), no RangeSync/BlockInputSync", () => {
    const modules = makeModules(ForkSeq.fulu);
    const sync = new BeaconSync({targetSync: true} as any, modules);

    expect(TargetSync).toHaveBeenCalledTimes(1);
    // db bridge: the low-level Db must be passed through, not IBeaconDb
    expect(TargetSync).toHaveBeenCalledWith(expect.objectContaining({targetSyncBlocks: modules.targetSyncBlocks}));

    const targetSyncInstance = (TargetSync as any).mock.results[0].value;
    expect(targetSyncInstance.start).toHaveBeenCalledTimes(1);

    expect(RangeSync).not.toHaveBeenCalled();
    expect(BlockInputSync).not.toHaveBeenCalled();

    expect((sync as any).targetSync).toBeDefined();
    expect((sync as any).rangeSync).toBeUndefined();
    expect((sync as any).unknownBlockSync).toBeUndefined();
  });

  // [A1] The spill boot wipe is UNCONDITIONAL: it fires from the constructor regardless of the
  // targetSync flag, so a crash with the flag on followed by a flag-off restart still wipes.
  it("boot-wipes the TargetSync spill bucket regardless of the targetSync flag", () => {
    const offModules = makeModules(ForkSeq.fulu);
    new BeaconSync({} as any, offModules);
    expect(offModules.targetSyncBlocks.truncateAll).toHaveBeenCalledTimes(1);

    const onModules = makeModules(ForkSeq.fulu);
    new BeaconSync({targetSync: true} as any, onModules);
    expect(onModules.targetSyncBlocks.truncateAll).toHaveBeenCalledTimes(1);
  });

  // (3) ON + pre-fulu: targetSync true but fork < fulu → fall back to Range/UnknownBlock
  it("flag on + fork < fulu → falls back to RangeSync + BlockInputSync, no TargetSync", () => {
    const modules = makeModules(ForkSeq.electra);
    const sync = new BeaconSync({targetSync: true} as any, modules);

    expect(RangeSync).toHaveBeenCalledTimes(1);
    expect(BlockInputSync).toHaveBeenCalledTimes(1);
    expect(TargetSync).not.toHaveBeenCalled();

    expect((sync as any).targetSync).toBeUndefined();
  });

  // (4) close() with targetSync active → targetSync.stop(); off path closes range/unknown
  it("close() with TargetSync active → calls targetSync.stop()", () => {
    const modules = makeModules(ForkSeq.fulu);
    const sync = new BeaconSync({targetSync: true} as any, modules);
    const targetSyncInstance = (TargetSync as any).mock.results[0].value;

    sync.close();
    expect(targetSyncInstance.stop).toHaveBeenCalledTimes(1);
  });

  it("close() with RangeSync active → calls rangeSync.close() + unknownBlockSync.close()", () => {
    const modules = makeModules(ForkSeq.fulu);
    const sync = new BeaconSync({} as any, modules);
    const rangeSyncInstance = (RangeSync as any).mock.results[0].value;
    const unknownBlockSyncInstance = (BlockInputSync as any).mock.results[0].value;

    sync.close();
    expect(rangeSyncInstance.close).toHaveBeenCalledTimes(1);
    expect(unknownBlockSyncInstance.close).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// F4: SyncState mapping + gossip toggle + metrics on the TargetSync (ON) path.
// ---------------------------------------------------------------------------

/** Override the TargetSync mock's progress accessors for the most-recently constructed instance. */
function setActiveChains(activeChains: number, isSyncingFinalized = false): void {
  const instance = (TargetSync as any).mock.results.at(-1).value;
  instance.activeChainCount = activeChains;
  instance.isSyncingFinalized = isSyncingFinalized;
}

describe("BeaconSync — TargetSync SyncState mapping (F4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // (1) active head-target chains + head behind clock → SyncingHead
  it("registry has active head-target chains + head behind → state is SyncingHead", () => {
    const modules = makeModules(ForkSeq.fulu, {currentSlot: 100, headSlot: 0});
    const sync = new BeaconSync({targetSync: true} as any, modules);
    setActiveChains(2, false);

    expect(sync.state).toBe(SyncState.SyncingHead);
  });

  // (1b) an active finalized-target chain + head behind → SyncingFinalized
  it("registry has an active finalized-target chain + head behind → state is SyncingFinalized", () => {
    const modules = makeModules(ForkSeq.fulu, {currentSlot: 100, headSlot: 0});
    const sync = new BeaconSync({targetSync: true} as any, modules);
    setActiveChains(1, true);

    expect(sync.state).toBe(SyncState.SyncingFinalized);
  });

  // (2) no active chains + head synced → Synced
  it("no active chains + head synced → state is Synced", () => {
    const modules = makeModules(ForkSeq.fulu, {currentSlot: 100, headSlot: 100});
    const sync = new BeaconSync({targetSync: true} as any, modules);
    setActiveChains(0);

    expect(sync.state).toBe(SyncState.Synced);
  });

  // (3) no active chains + head behind clock + NO Advanced peers → Stalled
  it("no active chains + head behind + no Advanced peers → state is Stalled", () => {
    const modules = makeModules(ForkSeq.fulu, {currentSlot: 100, headSlot: 0});
    const sync = new BeaconSync({targetSync: true} as any, modules);
    setActiveChains(0);

    expect(sync.state).toBe(SyncState.Stalled);
  });

  // (3b) RULING 6: zero targets with an ADVANCED peer present is a transient between
  // targets — SyncingHead, never Stalled (Stalled hard-fails validator endpoints).
  it("no active chains + head behind + Advanced peer present → SyncingHead, never Stalled", () => {
    const modules = makeModules(ForkSeq.fulu, {currentSlot: 100, headSlot: 0});
    const sync = new BeaconSync({targetSync: true} as any, modules);
    setActiveChains(0);
    (sync as any).peerSyncType.set("peerA", "Advanced");

    expect(sync.state).toBe(SyncState.SyncingHead);
  });
});

describe("BeaconSync — TargetSync gossip toggle (F4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // (4) Synced + epoch ok → subscribeGossipCoreTopics on the once-per-epoch trigger
  it("Synced → once-per-epoch trigger subscribes gossip core topics", async () => {
    const modules = makeModules(ForkSeq.fulu, {currentSlot: 100, headSlot: 100, currentEpoch: 0});
    new BeaconSync({targetSync: true} as any, modules);
    setActiveChains(0);

    // The ON path must register a clock:epoch handler that drives updateSyncState.
    const epochHandlers = modules.clockHandlers.get("clock:epoch") ?? [];
    expect(epochHandlers.length).toBeGreaterThan(0);

    for (const fn of epochHandlers) fn();
    await Promise.resolve();

    expect(modules.network.subscribeGossipCoreTopics).toHaveBeenCalledTimes(1);
    expect(modules.network.unsubscribeGossipCoreTopics).not.toHaveBeenCalled();
  });

  // (5) Behind + already subscribed → once-per-epoch trigger unsubscribes
  it("fallen behind → once-per-epoch trigger unsubscribes gossip core topics", async () => {
    const modules = makeModules(ForkSeq.fulu, {
      currentSlot: 100,
      headSlot: 0,
      isSubscribedToGossipCoreTopics: true,
    });
    new BeaconSync({targetSync: true} as any, modules);
    setActiveChains(1);

    const epochHandlers = modules.clockHandlers.get("clock:epoch") ?? [];
    expect(epochHandlers.length).toBeGreaterThan(0);

    for (const fn of epochHandlers) fn();
    await Promise.resolve();

    expect(modules.network.unsubscribeGossipCoreTopics).toHaveBeenCalledTimes(1);
    expect(modules.network.subscribeGossipCoreTopics).not.toHaveBeenCalled();
  });

  // (6) Synced at startup: a connecting peer must drive a gossip subscribe promptly, rather than
  // wait up to a full epoch for the first ClockEvent.
  it("Synced at startup → subscribes gossip on peer connect, before any epoch tick", async () => {
    const modules = makeModules(ForkSeq.fulu, {currentSlot: 100, headSlot: 100, currentEpoch: 0});
    const ZERO = new Uint8Array(32);
    // addPeer reads our status and classifies the peer; a synced (remote == local) peer → FullySynced.
    modules.chain.getStatus = vi.fn(() => ({finalizedEpoch: 0, finalizedRoot: ZERO, headSlot: 100, headRoot: ZERO}));
    new BeaconSync({targetSync: true} as any, modules);
    setActiveChains(0);

    // No epoch tick has fired — only a peer connects.
    expect(modules.network.subscribeGossipCoreTopics).not.toHaveBeenCalled();
    modules.network.events.emit(NetworkEvent.peerConnected, {
      peer: "12D3KooWPeer1",
      status: {finalizedEpoch: 0, finalizedRoot: ZERO, headSlot: 100, headRoot: ZERO},
    } as any);
    await Promise.resolve();

    expect(modules.network.subscribeGossipCoreTopics).toHaveBeenCalledTimes(1);
  });

  // (7) The peerConnected wire must be matched by a peerDisconnected wire so peerSyncType (and its
  // gauge) is pruned rather than leaking one entry per peer ever connected.
  it("peerDisconnected on the TargetSync path prunes peerSyncType", () => {
    const modules = makeModules(ForkSeq.fulu, {currentSlot: 100, headSlot: 100, currentEpoch: 0});
    const ZERO = new Uint8Array(32);
    modules.chain.getStatus = vi.fn(() => ({finalizedEpoch: 0, finalizedRoot: ZERO, headSlot: 100, headRoot: ZERO}));
    const sync = new BeaconSync({targetSync: true} as any, modules);
    setActiveChains(0);
    const peerSyncType = (sync as unknown as {peerSyncType: Map<string, unknown>}).peerSyncType;

    modules.network.events.emit(NetworkEvent.peerConnected, {
      peer: "12D3KooWPeerX",
      status: {finalizedEpoch: 0, finalizedRoot: ZERO, headSlot: 100, headRoot: ZERO},
    } as any);
    expect(peerSyncType.size).toBe(1);

    modules.network.events.emit(NetworkEvent.peerDisconnected, {peer: "12D3KooWPeerX"} as any);
    expect(peerSyncType.size).toBe(0);
  });
});

describe("BeaconSync — TargetSync metrics (F4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("scrapeMetrics sets the targetSync active-chains gauge from registry progress", () => {
    const modules = makeModules(ForkSeq.fulu, {currentSlot: 100, headSlot: 0});
    const targetSync = {
      activeChains: {set: vi.fn()},
    };
    const metrics = {
      syncStatus: {set: vi.fn(), addCollect: vi.fn()},
      syncPeersBySyncType: {set: vi.fn()},
      targetSync,
    } as any;
    const sync = new BeaconSync({targetSync: true} as any, {...modules, metrics});
    setActiveChains(3);

    (sync as any).scrapeMetrics(metrics);

    expect(targetSync.activeChains.set).toHaveBeenCalledWith(3);
    // The derived state is exported via `lodestar_sync_status`, asserted by the mapping suite.
    expect(metrics.syncStatus.set).toHaveBeenCalledWith(syncStateMetric[SyncState.SyncingHead]);
  });
});
