import {describe, expect, it, vi} from "vitest";
import {testLogger} from "@lodestar/logger/test-utils";
import {RootHex, Slot} from "@lodestar/types";
import {INVALID_BYTES_REPORT_THRESHOLD, InvalidBytesLedger} from "../../../../src/sync/target/quotaLedger.js";
import {SpillStore} from "../../../../src/sync/target/spillStore.js";
import {
  IMPORT_ATTEMPTS_MAX,
  RECENTLY_DROPPED_MS,
  TargetStore,
  TargetStoreDeps,
  WALK_ATTEMPTS_MAX,
} from "../../../../src/sync/target/targetStore.js";
import {
  HeaderChainElement,
  TARGETS_PER_ADVOCATE_MAX,
  TARGET_QUEUE_MAX,
  Target,
} from "../../../../src/sync/target/types.js";
import {WalkHopResult} from "../../../../src/sync/target/walker.js";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function el(root: RootHex, slot: Slot): HeaderChainElement {
  return {root, parentRoot: "0xparent", slot, blockHash: "0x00", parentBlockHash: "0x00", blobCount: 0};
}

function makeHarness(opts: {floor?: Slot; inForkChoice?: Set<RootHex>} = {}) {
  const clock = {t: 1_000_000};
  const inForkChoice = opts.inForkChoice ?? new Set<RootHex>();
  const invalidBytes = new InvalidBytesLedger(() => clock.t);
  const reportPeerMid = vi.fn();
  const reportPeerLow = vi.fn();
  const onWaiters = vi.fn();
  const onCompleted = vi.fn();
  const spillClears: RootHex[] = [];

  const deps: TargetStoreDeps = {
    now: () => clock.t,
    finalizedSlot: () => opts.floor ?? 100,
    hasBlockHex: (root) => inForkChoice.has(root),
    createSpill: (targetRoot) =>
      ({
        clear: vi.fn(async () => {
          spillClears.push(targetRoot);
        }),
      }) as unknown as SpillStore,
    invalidBytes,
    reportPeerMid,
    reportPeerLow,
    onWaiters,
    onCompleted,
    logger: testLogger(),
    signal: new AbortController().signal,
  };
  const store = new TargetStore(deps);
  return {store, clock, inForkChoice, invalidBytes, reportPeerMid, reportPeerLow, onWaiters, onCompleted, spillClears};
}

function admit(store: TargetStore, root: RootHex, opts: Partial<Parameters<TargetStore["upsert"]>[0]> = {}): Target {
  const res = store.upsert({root, kind: "head", slotHint: 1000, ...opts});
  if (res.result !== "admitted") throw new Error(`expected admitted, got ${res.result}`);
  return res.target;
}

/** Walk one verified hop's worth of elements onto the target and register ownership. */
function walkOnto(store: TargetStore, target: Target, els: HeaderChainElement[], anchor: RootHex): void {
  const prevLen = target.headerChain.length;
  target.headerChain.push(...els);
  target.walkAnchor = anchor;
  store.onWalkResult(target, {outcome: "progress"}, prevLen);
}

describe("sync / target / targetStore", () => {
  describe("admission", () => {
    it("gates: inForkChoice, belowFloor [A8], badTarget, cooldown, advocateCap", () => {
      const h = makeHarness({floor: 100});

      h.inForkChoice.add("0xknown");
      expect(h.store.upsert({root: "0xknown", kind: "head"})).toEqual({result: "rejected", reason: "inForkChoice"});

      expect(h.store.upsert({root: "0xold", kind: "head", slotHint: 100})).toEqual({
        result: "rejected",
        reason: "belowFloor",
      });

      // Proven invalid → badTargets blocks re-admission.
      const bad = admit(h.store, "0xbad");
      h.store.terminal(bad, "invalid", {firstInvalidRoot: null});
      expect(h.store.upsert({root: "0xbad", kind: "head", slotHint: 1000})).toEqual({
        result: "rejected",
        reason: "badTarget",
      });

      // Exhausted → cooldown blocks tight re-admission, expires after RECENTLY_DROPPED_MS.
      const tired = admit(h.store, "0xtired");
      h.store.terminal(tired, "exhausted");
      expect(h.store.upsert({root: "0xtired", kind: "head", slotHint: 1000})).toEqual({
        result: "rejected",
        reason: "cooldown",
      });
      h.clock.t += RECENTLY_DROPPED_MS + 1;
      expect(h.store.upsert({root: "0xtired", kind: "head", slotHint: 1000}).result).toBe("admitted");

      // Per-advocate cap: a peer may cause at most 2 live targets.
      admit(h.store, "0xa1", {peer: "spammy"});
      admit(h.store, "0xa2", {peer: "spammy"});
      expect(TARGETS_PER_ADVOCATE_MAX).toBe(2);
      expect(h.store.upsert({root: "0xa3", kind: "head", slotHint: 1000, peer: "spammy"})).toEqual({
        result: "rejected",
        reason: "advocateCap",
      });
      // Peerless admission is unaffected.
      expect(h.store.upsert({root: "0xa3", kind: "head", slotHint: 1000}).result).toBe("admitted");
    });

    it("queue cap: queued-only eviction admits only claims that outrank the victim", () => {
      const h = makeHarness();
      for (let i = 0; i < TARGET_QUEUE_MAX; i++) {
        admit(h.store, `0xq${i}`, {kind: "byRoot"});
      }
      // Same-rank claim → rejected.
      expect(h.store.upsert({root: "0xmore", kind: "byRoot", slotHint: 1000})).toEqual({
        result: "rejected",
        reason: "queueFull",
      });
      // Higher-rank claim evicts a queued byRoot target.
      expect(h.store.upsert({root: "0xfin", kind: "finalized", slotHint: 1000}).result).toBe("admitted");
      expect(h.store.targets.size).toBe(TARGET_QUEUE_MAX);
      expect(h.store.terminals.exhausted).toBe(1);
    });

    it("feeds an existing target (claimed-root advocates [A2], waiters, kind latest-wins)", () => {
      const h = makeHarness();
      const t = admit(h.store, "0xt", {kind: "finalized", peer: "p1"});
      const res = h.store.upsert({
        root: "0xt",
        kind: "head",
        peer: "p2",
        claimedRoot: "0xchild-of-t",
        waiter: {rootHex: "0xw", peer: "p2"},
      });
      expect(res.result).toBe("fed");
      expect(t.advocates.get("p1")).toBe("0xt");
      expect(t.advocates.get("p2")).toBe("0xchild-of-t");
      expect(t.waiters).toEqual([{rootHex: "0xw", peer: "p2"}]);
      expect(t.kind).toBe("head"); // latest classification wins
    });

    it("coalesces a claim for a root already walked by a live target", () => {
      const h = makeHarness();
      const owner = admit(h.store, "0xowner");
      walkOnto(h.store, owner, [el("0xmid", 990)], "0xbelow");

      const res = h.store.upsert({root: "0xmid", kind: "head", peer: "p9", claimedRoot: "0xmid"});
      expect(res).toEqual({result: "coalesced", owner});
      expect(owner.advocates.get("p9")).toBe("0xmid");
    });
  });

  describe("walk transitions", () => {
    it("intersected → importing; progress → walking; budget-guarded emptyHop → exhausted", () => {
      const h = makeHarness();
      const t = admit(h.store, "0xt");

      h.store.onWalkResult(t, {outcome: "progress"}, 0);
      expect(t.status).toEqual({kind: "walking"});

      h.store.onWalkResult(t, {outcome: "intersected", intersectionRoot: "0xi"}, 0);
      expect(t.status).toEqual({kind: "importing"});

      // emptyHop burns budget with expanding backoff; past the budget → exhausted.
      const t2 = admit(h.store, "0xt2");
      for (let i = 0; i <= WALK_ATTEMPTS_MAX; i++) {
        h.store.onWalkResult(t2, {outcome: "emptyHop"}, 0);
        if (t2.status.kind === "parked") {
          h.clock.t = t2.status.untilMs;
          h.store.onSlot(); // expire the park
        }
      }
      expect(t2.status).toEqual({kind: "terminal", terminal: "exhausted"});
      expect(h.store.targets.has("0xt2")).toBe(false);
    });

    it("peerStarved parks without burning budget", () => {
      const h = makeHarness();
      const t = admit(h.store, "0xt");
      h.store.onWalkResult(t, {outcome: "peerStarved", retryAtMs: h.clock.t + 5000}, 0);
      expect(t.status.kind).toBe("parked");
      expect(t.attempts.walk).toBe(0);
    });

    it("invalidChain → invalid: badTargets + advocates Mid + invalid-bytes settled", () => {
      const h = makeHarness();
      const t = admit(h.store, "0xevil", {peer: "advocate", claimedRoot: "0xevil"});
      h.invalidBytes.charge("0xevil", "server", INVALID_BYTES_REPORT_THRESHOLD);

      h.store.onWalkResult(t, {outcome: "invalidChain", reason: "finalityConflict"}, 0);

      expect(h.reportPeerMid).toHaveBeenCalledWith("advocate", "advocated_invalid:finalityConflict");
      expect(h.reportPeerLow).toHaveBeenCalledWith("server", "served_invalid_bytes");
      expect(h.store.upsert({root: "0xevil", kind: "head", slotHint: 1000})).toEqual({
        result: "rejected",
        reason: "badTarget",
      });
      expect(h.spillClears).toContain("0xevil");
    });

    it("tooOld / quotaExceeded / aborted terminals", () => {
      const h = makeHarness();
      const a = admit(h.store, "0xa");
      h.store.onWalkResult(a, {outcome: "tooOld"}, 0);
      expect(h.store.terminals.too_old).toBe(1);

      const b = admit(h.store, "0xb");
      h.store.onWalkResult(b, {outcome: "quotaExceeded"}, 0);
      expect(h.store.terminals.exhausted).toBe(1);

      const c = admit(h.store, "0xc");
      h.store.onWalkResult(c, {outcome: "aborted"}, 0);
      expect(h.store.terminals.aborted).toBe(1);
      expect(h.store.targets.size).toBe(0);
    });
  });

  describe("convergence + owner death [A4]", () => {
    function converge(h: ReturnType<typeof makeHarness>): {owner: Target; dep: Target} {
      const owner = admit(h.store, "0xowner");
      walkOnto(h.store, owner, [el("0xshared", 990)], "0xdeep");
      const dep = admit(h.store, "0xdep");
      // dep walks down to anchor onto the shared root owned by `owner`.
      walkOnto(h.store, dep, [el("0xdep-block", 995)], "0xshared");
      expect(dep.status).toEqual({kind: "awaitingOwner", owner: "0xowner"});
      return {owner, dep};
    }

    it("owner completed → dependent intersects at the convergence point and imports", () => {
      const h = makeHarness();
      const {owner, dep} = converge(h);
      h.store.terminal(owner, "completed");
      expect(dep.status).toEqual({kind: "importing"});
      expect(dep.intersectionRoot).toBe("0xshared");
    });

    it("owner invalid → dependent cascades to invalid (its chain includes the invalid segment)", () => {
      const h = makeHarness();
      const {owner, dep} = converge(h);
      h.store.terminal(owner, "invalid", {firstInvalidRoot: null});
      expect(dep.status).toEqual({kind: "terminal", terminal: "invalid"});
      expect(h.store.targets.size).toBe(0);
    });

    it("owner exhausted → dependent resumes walking from its preserved cursor", () => {
      const h = makeHarness();
      const {owner, dep} = converge(h);
      h.store.terminal(owner, "exhausted");
      expect(dep.status).toEqual({kind: "queued"});
      expect(dep.walkAnchor).toBe("0xshared"); // cursor preserved
      expect(dep.headerChain).toHaveLength(1);
    });
  });

  describe("waiters + scoring precision", () => {
    it("completed re-emits waiters [A10]", () => {
      const h = makeHarness();
      const t = admit(h.store, "0xt", {waiter: {rootHex: "0xw1", peer: "p1"}});
      h.store.upsert({root: "0xt", kind: "head", waiter: {rootHex: "0xw2", peer: "p2"}});
      h.store.terminal(t, "completed");
      expect(h.onWaiters).toHaveBeenCalledWith([
        {rootHex: "0xw1", peer: "p1"},
        {rootHex: "0xw2", peer: "p2"},
      ]);
    });

    it("[A2] import-level fault vindicates advocates of the imported prefix", () => {
      const h = makeHarness();
      const t = admit(h.store, "0xtip");
      // Bottom-first chain: low → mid → tip; fault at mid.
      t.headerChain = [el("0xlow", 990), el("0xmid", 991), el("0xtip", 992)];
      t.advocates.set("vindicated", "0xlow"); // claimed below the fault — imported fine
      t.advocates.set("guilty-mid", "0xmid"); // claimed the fault itself
      t.advocates.set("guilty-tip", "0xtip"); // claimed above the fault
      t.advocates.set("guilty-unknown", "0xelsewhere"); // unknown position → treated at-top

      h.store.terminal(t, "invalid", {firstInvalidRoot: "0xmid", reason: "stf"});

      const scored = h.reportPeerMid.mock.calls.map((c) => c[0]);
      expect(scored).not.toContain("vindicated");
      expect(scored).toContain("guilty-mid");
      expect(scored).toContain("guilty-tip");
      expect(scored).toContain("guilty-unknown");
    });
  });

  describe("time-driven maintenance", () => {
    it("onSlot expires parks to the right resume state", () => {
      const h = makeHarness();
      const walkT = admit(h.store, "0xw");
      const importT = admit(h.store, "0xi");
      h.store.park(walkT, "backoff", h.clock.t + 1000, "walk");
      h.store.park(importT, "awaitingData", h.clock.t + 1000, "import");

      h.store.onSlot(); // not yet
      expect(walkT.status.kind).toBe("parked");

      h.clock.t += 1001;
      h.store.onSlot();
      expect(walkT.status).toEqual({kind: "queued"});
      expect(importT.status).toEqual({kind: "importing"});
    });

    it("onFinalized drops below-floor targets and completes now-known roots", () => {
      const h = makeHarness();
      const stale = admit(h.store, "0xstale", {slotHint: 500});
      const done = admit(h.store, "0xdone", {slotHint: 2000});
      admit(h.store, "0xalive", {slotHint: 2000});

      h.inForkChoice.add("0xdone");
      h.store.onFinalized(600);

      expect(stale.status).toEqual({kind: "terminal", terminal: "too_old"});
      expect(done.status).toEqual({kind: "terminal", terminal: "completed"});
      expect(h.store.targets.size).toBe(1);
    });

    it("import attempts are budget-guarded [I2]", () => {
      const h = makeHarness();
      const t = admit(h.store, "0xt");
      h.store.onWalkResult(t, {outcome: "intersected", intersectionRoot: "0xi"}, 0);
      for (let i = 0; i <= IMPORT_ATTEMPTS_MAX; i++) {
        h.store.parkImportAttempt(t, "backoff");
        if (t.status.kind === "parked") {
          h.clock.t = t.status.untilMs;
          h.store.onSlot();
        }
      }
      expect(t.status).toEqual({kind: "terminal", terminal: "exhausted"});
    });

    it("reanchor resets the cursor and ownership for a rewalk", () => {
      const h = makeHarness();
      const t = admit(h.store, "0xt");
      walkOnto(h.store, t, [el("0xw1", 990)], "0xdeeper");
      expect(h.store.walkedRootsCount).toBe(2); // target root + walked block

      h.store.reanchor(t);
      expect(t.walkAnchor).toBe("0xt");
      expect(t.headerChain).toHaveLength(0);
      expect(t.status).toEqual({kind: "queued"});
      expect(h.store.walkedRootsCount).toBe(1); // just the target root again
    });
  });

  describe("PROPERTY: every admitted target reaches a terminal; all state released", () => {
    it("random event interleavings terminate with empty maps", () => {
      const h = makeHarness();
      // Deterministic PRNG (Math.imul avoids precision loss).
      let seed = 0xc0ffee;
      const rand = (): number => {
        seed = Math.imul(seed ^ (seed >>> 15), seed | 1) >>> 0;
        return (seed >>> 8) / 2 ** 24;
      };
      const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];

      const OUTCOMES: WalkHopResult[] = [
        {outcome: "progress"},
        {outcome: "intersected", intersectionRoot: "0xi"},
        {outcome: "tooOld"},
        {outcome: "invalidChain", reason: "finalityConflict"},
        {outcome: "emptyHop"},
        {outcome: "peerStarved", retryAtMs: 0},
        {outcome: "quotaExceeded"},
        {outcome: "aborted"},
      ];

      let admitted = 0;
      for (let step = 0; step < 3000; step++) {
        const roll = rand();
        if (roll < 0.25) {
          const res = h.store.upsert({
            root: `0xr${Math.floor(rand() * 300)}`,
            kind: pick(["head", "finalized", "byRoot"]),
            slotHint: 1000 + Math.floor(rand() * 100),
            peer: `peer${Math.floor(rand() * 10)}`,
          });
          if (res.result === "admitted") admitted++;
        } else if (roll < 0.75) {
          const live = [...h.store.targets.values()];
          if (live.length > 0) {
            const t = pick(live);
            if (t.status.kind === "queued" || t.status.kind === "walking") {
              const out = pick(OUTCOMES);
              if (out.outcome === "peerStarved") out.retryAtMs = h.clock.t + Math.floor(rand() * 5000);
              h.store.onWalkResult(t, out, t.headerChain.length);
            } else if (t.status.kind === "importing") {
              const r = rand();
              if (r < 0.3) h.store.terminal(t, "completed");
              else if (r < 0.4) h.store.terminal(t, "invalid", {firstInvalidRoot: null});
              else h.store.parkImportAttempt(t, pick(["backoff", "awaitingData", "elOffline"]));
            }
          }
        } else if (roll < 0.9) {
          h.clock.t += Math.floor(rand() * 10_000);
          h.store.onSlot();
        } else {
          h.store.onFinalized(900 + Math.floor(rand() * 300));
        }
      }
      expect(admitted).toBeGreaterThan(20);

      // Drain: with no external progress, budgets and parks must terminate everything.
      let guard = 0;
      while (h.store.targets.size > 0 && guard++ < 10_000) {
        h.clock.t += 61_000;
        h.store.onSlot();
        for (const t of [...h.store.targets.values()]) {
          if (t.status.kind === "queued" || t.status.kind === "walking") {
            h.store.onWalkResult(t, {outcome: "emptyHop"}, t.headerChain.length);
          } else if (t.status.kind === "importing") {
            h.store.parkImportAttempt(t, "backoff");
          }
          // parked → expired by the next onSlot; awaitingOwner → exits on its owner's terminal.
        }
      }

      expect(h.store.targets.size).toBe(0);
      expect(h.store.walkedRootsCount).toBe(0);
      const terminalSum = Object.values(h.store.terminals).reduce((a, b) => a + b, 0);
      expect(terminalSum).toBe(admitted);
    });
  });
});
