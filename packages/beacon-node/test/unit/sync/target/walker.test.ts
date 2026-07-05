import {describe, expect, it, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {mainnetChainConfig} from "@lodestar/config/configs";
import {ForkName} from "@lodestar/params";
import {RootHex, SignedBeaconBlock, Slot} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {ZERO_HASH} from "../../../../src/constants/index.js";
import {InvalidBytesLedger, QuotaLedger, defaultQuotaLimits} from "../../../../src/sync/target/quotaLedger.js";
import {SpillQuotaError, SpillStoreErrorCode} from "../../../../src/sync/target/spillStore.js";
import {Target} from "../../../../src/sync/target/types.js";
import {WalkerDeps, walkHop} from "../../../../src/sync/target/walker.js";
import {PeerIdStr} from "../../../../src/util/peerId.js";
import {config, generateBlock, slots} from "../../../utils/blocksAndData.js";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const BY_HEAD_SPACING = 15_000;

function blockRoot(block: SignedBeaconBlock): Uint8Array {
  return config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message);
}

/** Linked gloas chain, oldest-first; each child's parentRoot is its parent's real root. */
function buildLinkedChain(
  count: number,
  intersectionRoot: Uint8Array,
  baseSlot: number
): {blocks: SignedBeaconBlock[]; roots: Uint8Array[]; rootHexes: RootHex[]; targetRootHex: RootHex} {
  const blocks: SignedBeaconBlock[] = [];
  const roots: Uint8Array[] = [];
  const rootHexes: RootHex[] = [];
  for (let i = 0; i < count; i++) {
    const {block} = generateBlock({forkName: ForkName.gloas, slot: baseSlot + i});
    block.message.parentRoot = i === 0 ? intersectionRoot : roots[i - 1];
    const root = blockRoot(block);
    blocks.push(block);
    roots.push(root);
    rootHexes.push(toRootHex(root));
  }
  return {blocks, roots, rootHexes, targetRootHex: toRootHex(roots[count - 1])};
}

/** Honest server over a linked chain: serves `count` blocks newest-first from the requested root. */
function honestServer(blocks: SignedBeaconBlock[], roots: Uint8Array[], cap = Number.POSITIVE_INFINITY) {
  const indexByRootHex = new Map<RootHex, number>();
  for (let i = 0; i < blocks.length; i++) indexByRootHex.set(toRootHex(roots[i]), i);
  return async (beaconRoot: Uint8Array, count: number): Promise<SignedBeaconBlock[]> => {
    const startIdx = indexByRootHex.get(toRootHex(beaconRoot));
    if (startIdx === undefined) return [];
    const out: SignedBeaconBlock[] = [];
    for (let i = startIdx; i >= 0 && out.length < Math.min(count, cap); i--) out.push(blocks[i]);
    return out;
  };
}

type PeerScript = (beaconRoot: Uint8Array, count: number) => Promise<SignedBeaconBlock[]>;

function makeTarget(root: RootHex, advocates: [PeerIdStr, RootHex][] = []): Target {
  return {
    root,
    slotHint: undefined,
    kind: "head",
    status: {kind: "walking"},
    advocates: new Map(advocates),
    waiters: [],
    headerChain: [],
    walkAnchor: root,
    provenance: new Map(),
    intersectionRoot: undefined,
    attempts: {walk: 0, import: 0},
    spillBytes: 0,
    createdAtMs: 0,
    spill: {put: async () => {}} as unknown as Target["spill"],
  };
}

function makeHarness(opts: {
  peers: Record<PeerIdStr, PeerScript>;
  intersectionRootHex?: RootHex;
  floor: Slot;
  currentSlot: Slot;
  hopBlocks?: number;
  spillPut?: (root: RootHex, block: SignedBeaconBlock, signal?: AbortSignal) => Promise<void>;
}) {
  const clock = {t: 100_000};
  const ledger = new QuotaLedger(defaultQuotaLimits(createBeaconConfig(mainnetChainConfig, ZERO_HASH)), () => clock.t);
  const invalidBytes = new InvalidBytesLedger(() => clock.t);
  const reportPeerLow = vi.fn();
  const spillPut = opts.spillPut ?? vi.fn(async () => {});
  const abort = new AbortController();

  const deps: WalkerDeps = {
    config,
    hopBlocks: opts.hopBlocks ?? 128,
    currentSlot: () => opts.currentSlot,
    forkChoice: {
      hasBlockHex: (rootHex: RootHex) => rootHex === opts.intersectionRootHex,
      getFinalizedCheckpointSlot: () => opts.floor,
    },
    sendBeaconBlocksByHead: (peer, beaconRoot, count) => opts.peers[peer](beaconRoot, count),
    connectedPeers: () => Object.keys(opts.peers),
    ledger,
    invalidBytes,
    spill: {put: spillPut} as never,
    reportPeerLow,
    signal: abort.signal,
  };
  return {deps, clock, ledger, invalidBytes, reportPeerLow, spillPut, abort};
}

const baseSlot = slots.gloas + 1000;
const intersection = new Uint8Array(32).fill(0x11);
const intersectionHex = toRootHex(intersection);

describe("sync / target / walker", () => {
  it("multi-hop happy path: staged, provenance-attributed, intersected bottom-first", async () => {
    const chain = buildLinkedChain(5, intersection, baseSlot);
    const target = makeTarget(chain.targetRootHex);
    const h = makeHarness({
      peers: {p1: honestServer(chain.blocks, chain.roots), p2: honestServer(chain.blocks, chain.roots)},
      intersectionRootHex: intersectionHex,
      floor: baseSlot - 100,
      currentSlot: baseSlot + 10,
      hopBlocks: 2,
    });

    const outcomes: string[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await walkHop(target, h.deps);
      outcomes.push(res.outcome);
      if (res.outcome === "intersected") break;
      h.clock.t += BY_HEAD_SPACING; // respect ByHead spacing between hops
    }

    expect(outcomes).toEqual(["progress", "progress", "intersected"]);
    expect(target.intersectionRoot).toBe(intersectionHex);
    // Bottom-first after intersection: [0] is the oldest, last is the target.
    expect(target.headerChain.map((el) => el.root)).toEqual(chain.rootHexes);
    expect(h.spillPut).toHaveBeenCalledTimes(5);
    // Every staged block has a recorded serving peer.
    expect(target.provenance.size).toBe(5);
    for (const peer of target.provenance.values()) expect(["p1", "p2"]).toContain(peer);
    expect(h.reportPeerLow).not.toHaveBeenCalled();
  });

  it("NOT_ANCHORED (wrong first root): Low + exclude + walk preserved; rotation recovers", async () => {
    const chain = buildLinkedChain(3, intersection, baseSlot);
    const garbage = buildLinkedChain(3, new Uint8Array(32).fill(0x22), baseSlot + 50);
    const target = makeTarget(chain.targetRootHex);
    const h = makeHarness({
      peers: {
        liar: async () => [garbage.blocks[2], garbage.blocks[1]], // unrelated chain
        honest: honestServer(chain.blocks, chain.roots),
      },
      intersectionRootHex: intersectionHex,
      floor: baseSlot - 100,
      currentSlot: baseSlot + 10,
    });

    // Drive hops until terminal, allowing rotation.
    let res = await walkHop(target, h.deps);
    while (res.outcome === "emptyHop" || res.outcome === "progress") {
      h.clock.t += BY_HEAD_SPACING;
      res = await walkHop(target, h.deps);
    }

    expect(res.outcome).toBe("intersected");
    // If the liar was ever picked it was scored + excluded, and the walk still completed.
    if (h.reportPeerLow.mock.calls.length > 0) {
      expect(h.reportPeerLow).toHaveBeenCalledWith("liar", "byhead_not_anchored");
    }
    expect(target.headerChain.map((el) => el.root)).toEqual(chain.rootHexes);
  });

  it("NOT_LINEAR (garbage after valid prefix): prefix KEPT, Low, walk continues", async () => {
    const chain = buildLinkedChain(4, intersection, baseSlot);
    const {blocks: junk} = buildLinkedChain(1, new Uint8Array(32).fill(0x33), baseSlot + 70);
    const target = makeTarget(chain.targetRootHex);
    // Splicer serves [target, parent, GARBAGE] — valid 2-prefix then junk.
    const splicer: PeerScript = async () => [chain.blocks[3], chain.blocks[2], junk[0]];
    const h = makeHarness({
      peers: {splicer},
      intersectionRootHex: intersectionHex,
      floor: baseSlot - 100,
      currentSlot: baseSlot + 10,
    });

    const res = await walkHop(target, h.deps);
    expect(res.outcome).toBe("progress");
    expect(h.reportPeerLow).toHaveBeenCalledWith("splicer", "byhead_not_linear");
    // The hash-verified prefix (2 blocks) was staged; the cursor advanced to its parent.
    expect(target.headerChain).toHaveLength(2);
    expect(target.walkAnchor).toBe(chain.rootHexes[1]);
    expect(h.spillPut).toHaveBeenCalledTimes(2);
  });

  it("[A15] future tip: Low only when the server ADVOCATED the root; response discarded", async () => {
    const chain = buildLinkedChain(2, intersection, baseSlot + 100);
    // currentSlot far below the chain tip → tip is from the future.
    const currentSlot = baseSlot + 10;

    // Case 1: server advocated this root → exact attribution, Low.
    const advTarget = makeTarget(chain.targetRootHex, [["adv", chain.targetRootHex]]);
    const h1 = makeHarness({
      peers: {adv: honestServer(chain.blocks, chain.roots)},
      floor: baseSlot - 100,
      currentSlot,
    });
    expect((await walkHop(advTarget, h1.deps)).outcome).toBe("emptyHop");
    expect(h1.reportPeerLow).toHaveBeenCalledWith("adv", "byhead_future_tip");
    expect(h1.spillPut).not.toHaveBeenCalled();

    // Case 2: mere relayer → no score, just rotation.
    const relTarget = makeTarget(chain.targetRootHex);
    const h2 = makeHarness({
      peers: {relay: honestServer(chain.blocks, chain.roots)},
      floor: baseSlot - 100,
      currentSlot,
    });
    expect((await walkHop(relTarget, h2.deps)).outcome).toBe("emptyHop");
    expect(h2.reportPeerLow).not.toHaveBeenCalled();
  });

  it("[A8] tooOld: tip at/below the finalized floor — no penalty, nothing staged", async () => {
    const chain = buildLinkedChain(3, intersection, baseSlot);
    const target = makeTarget(chain.targetRootHex);
    const h = makeHarness({
      peers: {p1: honestServer(chain.blocks, chain.roots)},
      floor: baseSlot + 10, // finalized above the whole chain
      currentSlot: baseSlot + 20,
    });

    const res = await walkHop(target, h.deps);
    expect(res.outcome).toBe("tooOld");
    expect(h.reportPeerLow).not.toHaveBeenCalled();
    expect(h.spillPut).not.toHaveBeenCalled();
  });

  it("finality conflict: tip above floor descends past it without intersecting → invalidChain", async () => {
    const chain = buildLinkedChain(4, intersection, baseSlot);
    const target = makeTarget(chain.targetRootHex);
    const h = makeHarness({
      peers: {p1: honestServer(chain.blocks, chain.roots)},
      // No intersection anywhere; floor sits inside the chain span.
      floor: baseSlot + 1,
      currentSlot: baseSlot + 10,
    });

    const res = await walkHop(target, h.deps);
    expect(res).toEqual({outcome: "invalidChain", reason: "finalityConflict"});
  });

  it("slot games: hash-linked chain with non-descending slots → invalidChain (chain verdict, no peer score)", async () => {
    // parent has a HIGHER slot than its child — impossible in a real chain, but
    // hash-linkable in a fabricated one.
    const {block: parent} = generateBlock({forkName: ForkName.gloas, slot: baseSlot + 5});
    parent.message.parentRoot = new Uint8Array(32).fill(0x44);
    const parentRoot = blockRoot(parent);
    const {block: child} = generateBlock({forkName: ForkName.gloas, slot: baseSlot});
    child.message.parentRoot = parentRoot;
    const childRoot = blockRoot(child);

    const target = makeTarget(toRootHex(childRoot));
    const h = makeHarness({
      peers: {p1: async () => [child, parent]},
      floor: baseSlot - 100,
      currentSlot: baseSlot + 10,
    });

    const res = await walkHop(target, h.deps);
    expect(res).toEqual({outcome: "invalidChain", reason: "nonMonotonicSlots"});
    expect(h.reportPeerLow).not.toHaveBeenCalled();
  });

  it("peerStarved with retry advice when quota blocks the only peer; exclude-reset when cornered", async () => {
    const chain = buildLinkedChain(6, intersection, baseSlot);
    const target = makeTarget(chain.targetRootHex);
    const h = makeHarness({
      peers: {p1: honestServer(chain.blocks, chain.roots)},
      intersectionRootHex: intersectionHex,
      floor: baseSlot - 100,
      currentSlot: baseSlot + 10,
      hopBlocks: 2,
    });

    expect((await walkHop(target, h.deps)).outcome).toBe("progress");
    // Immediately again: ByHead spacing blocks the only peer → starved with advice.
    const starved = await walkHop(target, h.deps);
    expect(starved.outcome).toBe("peerStarved");
    if (starved.outcome === "peerStarved") {
      expect(starved.retryAtMs).toBe(h.clock.t + BY_HEAD_SPACING);
    }

    // Cornered by exclusions: a failing peer set resets rotation state instead of wedging.
    const failingTarget = makeTarget(chain.targetRootHex);
    failingTarget.walkExclude = new Set(["p1"]);
    const cornered = await walkHop(failingTarget, h.deps);
    expect(cornered.outcome).toBe("emptyHop");
    expect(failingTarget.walkExclude).toBeUndefined();
  });

  it("spill quota breach → quotaExceeded (bounds before write)", async () => {
    const chain = buildLinkedChain(2, intersection, baseSlot);
    const target = makeTarget(chain.targetRootHex);
    const h = makeHarness({
      peers: {p1: honestServer(chain.blocks, chain.roots)},
      floor: baseSlot - 100,
      currentSlot: baseSlot + 10,
      spillPut: async () => {
        throw new SpillQuotaError({
          code: SpillStoreErrorCode.QUOTA_EXCEEDED,
          scope: "target",
          usedBytes: 1,
          quotaBytes: 1,
        });
      },
    });

    expect((await walkHop(target, h.deps)).outcome).toBe("quotaExceeded");
  });

  it("abort: no network call on a pre-aborted signal", async () => {
    const chain = buildLinkedChain(2, intersection, baseSlot);
    const target = makeTarget(chain.targetRootHex);
    const send = vi.fn();
    const h = makeHarness({
      peers: {p1: send as never},
      floor: baseSlot - 100,
      currentSlot: baseSlot + 10,
    });
    h.abort.abort();

    expect((await walkHop(target, h.deps)).outcome).toBe("aborted");
    expect(send).not.toHaveBeenCalled();
  });

  it("[A9] staged bytes convert to counted invalid bytes on the invalid verdict", async () => {
    const chain = buildLinkedChain(3, intersection, baseSlot);
    const target = makeTarget(chain.targetRootHex);
    const h = makeHarness({
      peers: {p1: honestServer(chain.blocks, chain.roots)},
      floor: baseSlot + 1, // forces finalityConflict after staging some blocks
      currentSlot: baseSlot + 10,
    });

    const res = await walkHop(target, h.deps);
    expect(res).toEqual({outcome: "invalidChain", reason: "finalityConflict"});
    // Pending bytes were charged during the hop; the FSM settles them on the verdict.
    const report = vi.fn();
    h.invalidBytes.settleInvalid(target.root, report);
    expect(h.invalidBytes.countedBytes("p1")).toBeGreaterThan(0);
  });
});
