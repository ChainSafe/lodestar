import {afterEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {testLogger} from "@lodestar/logger/test-utils";
import {RootHex} from "@lodestar/types";
import {ChainEvent, ChainEventEmitter} from "../../../../src/chain/emitter.js";
import {IBeaconChain} from "../../../../src/chain/interface.js";
import {NetworkEvent, NetworkEventBus} from "../../../../src/network/events.js";
import * as assertPeerRelevanceModule from "../../../../src/network/peers/utils/assertPeerRelevance.js";
import {FillPool, FillTask} from "../../../../src/sync/target/fillPool.js";
import {TargetStore} from "../../../../src/sync/target/targetStore.js";
import {TargetSync, TargetSyncModules} from "../../../../src/sync/target/targetSync.js";
import * as missingDependencyModule from "../../../../src/sync/utils/missingDependency.js";
import * as remoteSyncTypeModule from "../../../../src/sync/utils/remoteSyncType.js";
import {config as testConfig} from "../../../utils/blocksAndData.js";

// ---------------------------------------------------------------------------
// Facade wiring tests: the routing table, admission gating, and the close
// lifecycle. Component behavior (walker/importer/fills/store) is pinned by
// their own suites; here we assert events reach the right mechanism.
// ---------------------------------------------------------------------------

const config = Object.assign(Object.create(Object.getPrototypeOf(testConfig)), testConfig, {
  MAX_REQUEST_BLOCKS_DENEB: 128,
  MAX_REQUEST_DATA_COLUMN_SIDECARS: 16384,
  MAX_REQUEST_PAYLOADS: 128,
}) as TargetSyncModules["config"];

function makeHarness(opts: {inForkChoice?: Set<RootHex>; onCompleted?: () => void; metrics?: unknown} = {}) {
  const inForkChoice = opts.inForkChoice ?? new Set<RootHex>();
  const emitter = new ChainEventEmitter();
  const networkEvents = new NetworkEventBus();

  const clockHandlers = new Map<string, ((...args: unknown[]) => void)[]>();
  const clock = {
    currentSlot: 1000,
    currentEpoch: 100,
    on: vi.fn((ev: string, fn: (...args: unknown[]) => void) => {
      clockHandlers.set(ev, [...(clockHandlers.get(ev) ?? []), fn]);
    }),
    off: vi.fn(),
  };

  const chain = {
    emitter,
    clock,
    config,
    forkChoice: {
      hasBlockHex: (root: RootHex) => inForkChoice.has(root),
      getFinalizedCheckpointSlot: () => 100,
      getBlockHexAndBlockHash: vi.fn(() => null),
    },
    getStatus: vi.fn(() => ({
      finalizedEpoch: 10,
      finalizedRoot: new Uint8Array(32),
      headSlot: 990,
      headRoot: new Uint8Array(32),
    })),
    seenBlockInputCache: {get: vi.fn(() => undefined), getByBlock: vi.fn()},
    seenPayloadEnvelopeInputCache: {get: vi.fn(() => undefined)},
    seenPayloadEnvelope: vi.fn(() => false),
    getBlockByRoot: vi.fn(async () => null),
    processExecutionPayload: vi.fn(async () => {}),
    processBlock: vi.fn(async () => {}),
    custodyConfig: {sampledColumns: [], custodyColumns: []},
  } as unknown as IBeaconChain;

  const repoCalls: string[] = [];
  const targetSyncBlocks = {
    encodeValue: vi.fn(() => new Uint8Array(8)),
    getId: vi.fn(() => new Uint8Array(40)),
    putBinary: vi.fn(async () => {
      repoCalls.push("putBinary");
    }),
    get: vi.fn(async () => null),
    batch: vi.fn(async () => {
      repoCalls.push("batch");
    }),
    deleteMany: vi.fn(async () => {
      repoCalls.push("deleteMany");
    }),
  } as unknown as TargetSyncModules["targetSyncBlocks"];

  const network = {
    events: networkEvents,
    getConnectedPeers: vi.fn(() => ["p1", "p2"]),
    sendBeaconBlocksByHead: vi.fn(async () => []),
    reStatusPeers: vi.fn(async () => {}),
    reportPeer: vi.fn(),
  } as unknown as TargetSyncModules["network"];

  const ts = new TargetSync({
    config,
    chain,
    network,
    logger: testLogger(),
    metrics: (opts.metrics ?? null) as never,
    targetSyncBlocks,
    spillWiped: Promise.resolve(0),
    onCompleted: opts.onCompleted,
  });

  // Wiring observability: spy the internal routing sinks.
  const fills = (ts as unknown as {fills: FillPool}).fills;
  const submit = vi.spyOn(fills, "submit");
  const store = (ts as unknown as {store: TargetStore}).store;
  const upsert = vi.spyOn(store, "upsert");

  return {
    ts,
    emitter,
    networkEvents,
    clock,
    clockHandlers,
    chain,
    network,
    submit,
    upsert,
    store,
    repoCalls,
    inForkChoice,
  };
}

function makeHarnessWithMetrics(metrics: never): ReturnType<typeof makeHarness> {
  return makeHarness({metrics});
}

function lastSubmit(submit: {mock: {calls: unknown[][]}}): FillTask {
  return (submit.mock.calls.at(-1) as unknown[])[0] as FillTask;
}

describe("sync / target / targetSync facade", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("routing table", () => {
    it("unknownBlockRoot → BlockFill with the gossip-source hint peer", () => {
      const h = makeHarness();
      h.ts.start();
      h.emitter.emit(ChainEvent.unknownBlockRoot, {rootHex: "0xaa", peer: "p1", slot: 900} as never);
      expect(lastSubmit(h.submit)).toEqual({kind: "block", root: "0xaa", hintPeer: "p1"});

      // Floor gate: a referencing slot at/below the finalized floor is provably stale — dropped
      // before any fetch [A8].
      const submits = h.submit.mock.calls.length;
      h.emitter.emit(ChainEvent.unknownBlockRoot, {rootHex: "0xdead", peer: "p1", slot: 100} as never);
      expect(h.submit.mock.calls.length).toBe(submits);
      h.ts.stop();
    });

    it("unknownEnvelopeBlockRoot → EnvelopeFill", () => {
      const h = makeHarness();
      h.ts.start();
      h.emitter.emit(ChainEvent.unknownEnvelopeBlockRoot, {rootHex: "0xbb", peer: "p1", slot: 0} as never);
      expect(lastSubmit(h.submit)).toEqual({kind: "envelope", root: "0xbb"});
      h.ts.stop();
    });

    it("incompleteBlockInput / incompletePayloadEnvelope → ColumnFill of the right input kind", () => {
      const h = makeHarness();
      h.ts.start();
      const blockInput = {blockRootHex: "0xcc"};
      h.emitter.emit(ChainEvent.incompleteBlockInput, {blockInput, peer: "p1"} as never);
      expect(lastSubmit(h.submit)).toEqual({kind: "columns", root: "0xcc", input: blockInput, inputKind: "block"});

      const payloadInput = {blockRootHex: "0xdd"};
      h.emitter.emit(ChainEvent.incompletePayloadEnvelope, {payloadInput, peer: "p1"} as never);
      expect(lastSubmit(h.submit)).toEqual({kind: "columns", root: "0xdd", input: payloadInput, inputKind: "payload"});
      h.ts.stop();
    });

    it("blockUnknownParent routes by classified dependency kind", () => {
      const h = makeHarness();
      h.ts.start();
      const classify = vi.spyOn(missingDependencyModule, "classifyMissingDependency");
      const blockInput = {blockRootHex: "0xchild", parentRootHex: "0xparent"} as never;

      // parentBlock → target the PARENT with the child as waiter + claimed root [A2].
      classify.mockReturnValueOnce({kind: "parentBlock", rootHex: "0xparent"});
      h.emitter.emit(ChainEvent.blockUnknownParent, {blockInput, peer: "p1", source: 0 as never});
      expect(h.upsert).toHaveBeenCalledWith({
        root: "0xparent",
        kind: "byRoot",
        peer: "p1",
        claimedRoot: "0xchild",
        waiter: {rootHex: "0xchild", peer: "p1"},
      });

      // parentPayload → EnvelopeFill of the parent (a fill, never a walk).
      classify.mockReturnValueOnce({kind: "parentPayload", rootHex: "0xparent"});
      h.emitter.emit(ChainEvent.blockUnknownParent, {blockInput, peer: "p1", source: 0 as never});
      expect(lastSubmit(h.submit)).toEqual({kind: "envelope", root: "0xparent"});

      // block → BlockFill.
      classify.mockReturnValueOnce({kind: "block", rootHex: "0xchild"});
      h.emitter.emit(ChainEvent.blockUnknownParent, {blockInput, peer: "p1", source: 0 as never});
      expect(lastSubmit(h.submit)).toEqual({kind: "block", root: "0xchild", hintPeer: "p1"});

      // invalidParentPayload → advertising peer scored, no fill/target.
      const submitCount = h.submit.mock.calls.length;
      classify.mockReturnValueOnce({
        kind: "invalidParentPayload",
        parentRootHex: "0xparent",
        parentBlockHashHex: "0xh",
      });
      h.emitter.emit(ChainEvent.blockUnknownParent, {blockInput, peer: "p1", source: 0 as never});
      expect(h.submit.mock.calls.length).toBe(submitCount);
      expect(h.network.reportPeer).toHaveBeenCalled();
      h.ts.stop();
    });

    it("peerConnected (relevant, unknown target) → admission-gated finalized/head target with slotHint", () => {
      const h = makeHarness();
      h.ts.start();
      vi.spyOn(assertPeerRelevanceModule, "assertPeerRelevance").mockReturnValue(null);
      const targetRoot = new Uint8Array(32).fill(7);
      vi.spyOn(remoteSyncTypeModule, "getRangeSyncTarget").mockReturnValue({
        syncType: remoteSyncTypeModule.RangeSyncType.Finalized,
        startEpoch: 0,
        target: {slot: 1200, root: targetRoot},
      });

      h.networkEvents.emit(NetworkEvent.peerConnected, {peer: "p1", status: {}} as never);
      expect(h.upsert).toHaveBeenCalledWith(expect.objectContaining({kind: "finalized", slotHint: 1200, peer: "p1"}));
      h.ts.stop();
    });

    it("peerConnected with an already-known target root → no target (fills handle DA)", () => {
      const h = makeHarness({inForkChoice: new Set(["0x" + "07".repeat(32)])});
      h.ts.start();
      vi.spyOn(assertPeerRelevanceModule, "assertPeerRelevance").mockReturnValue(null);
      const targetRoot = new Uint8Array(32).fill(7);
      vi.spyOn(remoteSyncTypeModule, "getRangeSyncTarget").mockReturnValue({
        syncType: remoteSyncTypeModule.RangeSyncType.Head,
        startEpoch: 0,
        target: {slot: 1200, root: targetRoot},
      });

      h.networkEvents.emit(NetworkEvent.peerConnected, {peer: "p1", status: {}} as never);
      expect(h.upsert).not.toHaveBeenCalled();
      h.ts.stop();
    });
  });

  describe("lifecycle", () => {
    it("start subscribes; stop detaches every listener, aborts all targets, zero db writes", async () => {
      const h = makeHarness();
      h.ts.start();

      const chainEvents = [
        ChainEvent.unknownBlockRoot,
        ChainEvent.unknownEnvelopeBlockRoot,
        ChainEvent.blockUnknownParent,
        ChainEvent.incompleteBlockInput,
        ChainEvent.incompletePayloadEnvelope,
        ChainEvent.forkChoiceFinalized,
      ];
      for (const ev of chainEvents) expect(h.emitter.listenerCount(ev)).toBe(1);
      expect(
        (h.networkEvents as unknown as {listenerCount(ev: string): number}).listenerCount(NetworkEvent.peerConnected)
      ).toBe(1);
      expect(h.clock.on).toHaveBeenCalledWith("clock:slot", expect.any(Function));

      // Live target to prove abortAll runs.
      h.store.upsert({root: "0x11fe", kind: "head", slotHint: 900});
      expect(h.ts.activeChainCount).toBe(1);

      h.ts.stop();

      for (const ev of chainEvents) expect(h.emitter.listenerCount(ev)).toBe(0);
      expect(
        (h.networkEvents as unknown as {listenerCount(ev: string): number}).listenerCount(NetworkEvent.peerConnected)
      ).toBe(0);
      expect(h.clock.off).toHaveBeenCalledWith("clock:slot", expect.any(Function));
      expect(h.ts.activeChainCount).toBe(0);
      expect(h.store.terminals.aborted).toBe(1);

      // close() discipline: ZERO db writes — the boot wipe owns the rows [A1][A12].
      await new Promise((r) => setTimeout(r, 5));
      expect(h.repoCalls).toEqual([]);

      // Post-close events are no-ops.
      h.emitter.emit(ChainEvent.unknownBlockRoot, {rootHex: "0xafter", peer: "p1", slot: 900} as never);
      expect(h.submit).not.toHaveBeenCalledWith(expect.objectContaining({root: "0xafter"}));
    });

    it("sync-state API: activeChainCount + isSyncingFinalized derive from the store", () => {
      const h = makeHarness();
      h.ts.start();
      expect(h.ts.activeChainCount).toBe(0);
      expect(h.ts.isSyncingFinalized).toBe(false);
      h.store.upsert({root: "0xf1f1", kind: "finalized", slotHint: 900});
      expect(h.ts.activeChainCount).toBe(1);
      expect(h.ts.isSyncingFinalized).toBe(true);
      h.ts.stop();
    });

    it("escalate (fill → target) admits via the same gated path", () => {
      const h = makeHarness();
      h.ts.start();
      const escalate = (h.ts as unknown as {upsertTarget: (c: unknown) => boolean}).upsertTarget.bind(h.ts);
      expect(escalate({root: "0xe5c0", kind: "byRoot"})).toBe(true);
      expect(h.ts.activeChainCount).toBe(1);
      // In fork choice → no target.
      h.inForkChoice.add("0xknown");
      expect(escalate({root: "0xknown", kind: "byRoot"})).toBe(false);
      h.ts.stop();
    });
  });

  describe("observability", () => {
    it("collect sets FSM/fill gauges; debug state maps live targets", () => {
      const gaugeSets = new Map<string, number>();
      const labeledGauge = (prefix: string) => ({
        set: vi.fn((labels: Record<string, string>, v: number) => {
          gaugeSets.set(`${prefix}:${Object.values(labels)[0]}`, v);
        }),
        addCollect: vi.fn(),
      });
      let collect: (() => void) | undefined;
      const targetsByState = {
        ...labeledGauge("targets"),
        addCollect: vi.fn((fn: () => void) => {
          collect = fn;
        }),
      };
      const metrics = {
        targetSync: {
          activeChains: {set: vi.fn()},
          targetsByState,
          targetsTerminalTotal: labeledGauge("terminal"),
          walkHopsTotal: {inc: vi.fn()},
          importStepsTotal: {inc: vi.fn()},
          fillTasks: labeledGauge("fills"),
          dataFillUnexpectedErrorTotal: {inc: vi.fn()},
          bootWipeRowsTotal: {inc: vi.fn()},
          spillBytes: {set: vi.fn()},
        },
      };

      const h = makeHarnessWithMetrics(metrics as never);
      h.ts.start();
      h.store.upsert({root: "0xf1f1", kind: "finalized", slotHint: 900, peer: "p1"});
      collect?.();

      expect(gaugeSets.get("targets:queued")).toBe(1);
      expect(gaugeSets.get("fills:active")).toBe(0);
      expect(metrics.targetSync.activeChains.set).toHaveBeenCalledWith(1);

      const debug = h.ts.getSyncChainsDebugState();
      expect(debug).toHaveLength(1);
      expect(debug[0]).toMatchObject({targetRoot: "0xf1f1", targetSlot: 900, peers: 1});
      h.ts.stop();
    });

    it("onCompleted callback fires on target completion (BeaconSync re-derives state)", () => {
      const onCompleted = vi.fn();
      const h = makeHarness({onCompleted});
      h.ts.start();
      const res = h.store.upsert({root: "0xdead", kind: "head", slotHint: 900});
      if (res.result !== "admitted") throw new Error("expected admitted");
      h.store.terminal(res.target, "completed");
      expect(onCompleted).toHaveBeenCalledTimes(1);
      h.ts.stop();
    });
  });

  describe("import-event wakes", () => {
    it("EventType.block wakes envelope fills parked on the root; EventType.executionPayload releases children", () => {
      const h = makeHarness({});
      h.ts.start();
      const fills = (h.ts as unknown as {fills: {onBlockKnown: (r: RootHex) => void}}).fills;
      const onBlockKnown = vi.spyOn(fills, "onBlockKnown");

      h.emitter.emit(routes.events.EventType.block, {block: "0xb10c", slot: 900, executionOptimistic: false} as never);
      expect(onBlockKnown).toHaveBeenCalledWith("0xb10c");

      // parentPayload child released on the payload-import event.
      const classify = vi.spyOn(missingDependencyModule, "classifyMissingDependency");
      classify.mockReturnValueOnce({kind: "parentPayload", rootHex: "0xdad0"});
      h.emitter.emit(ChainEvent.blockUnknownParent, {
        blockInput: {blockRootHex: "0xc11d", parentRootHex: "0xdad0"} as never,
        peer: "p1",
        source: 0 as never,
      });
      const cachedChild = {blockRootHex: "0xc11d"};
      (h.chain.seenBlockInputCache.get as ReturnType<typeof vi.fn>).mockReturnValue(cachedChild);
      h.emitter.emit(routes.events.EventType.executionPayload, {blockRoot: "0xdad0"} as never);
      expect(lastSubmit(h.submit)).toEqual({kind: "columns", root: "0xc11d", input: cachedChild, inputKind: "block"});
      h.ts.stop();
    });
  });

  describe("parentPayload child re-drive", () => {
    it("children blocked on a parent payload are re-emitted when it imports", () => {
      const h = makeHarness();
      h.ts.start();
      const classify = vi.spyOn(missingDependencyModule, "classifyMissingDependency");
      const blockInput = {blockRootHex: "0xchild", parentRootHex: "0xparent"} as never;
      classify.mockReturnValueOnce({kind: "parentPayload", rootHex: "0xparent"});
      h.emitter.emit(ChainEvent.blockUnknownParent, {blockInput, peer: "p1", source: 0 as never});

      // The child is rehydrated from the seen cache when the parent's payload lands [A10].
      const cachedChild = {blockRootHex: "0xchild"};
      (h.chain.seenBlockInputCache.get as ReturnType<typeof vi.fn>).mockReturnValue(cachedChild);
      (h.ts as unknown as {onPayloadProcessed: (root: RootHex) => void}).onPayloadProcessed("0xparent");

      expect(lastSubmit(h.submit)).toEqual({kind: "columns", root: "0xchild", input: cachedChild, inputKind: "block"});
      h.ts.stop();
    });
  });
});
