import {afterEach, describe, expect, it, vi} from "vitest";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {RootHex, Slot} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {AttestationImportOpt} from "../../../../src/chain/blocks/types.js";
import {BlockError, BlockErrorCode} from "../../../../src/chain/errors/blockError.js";
import {IBeaconChain} from "../../../../src/chain/interface.js";
import * as dataFillModule from "../../../../src/sync/target/dataFill.js";
import {ImporterDeps, importNextSegment} from "../../../../src/sync/target/importer.js";
import {QuotaLedger, defaultQuotaLimits} from "../../../../src/sync/target/quotaLedger.js";
import {HeaderChainElement, Target} from "../../../../src/sync/target/types.js";
import {PeerIdStr} from "../../../../src/util/peerId.js";
import {config, generateBlock, slots} from "../../../utils/blocksAndData.js";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const EPOCH0 = Math.floor((slots.gloas + SLOTS_PER_EPOCH) / SLOTS_PER_EPOCH) + 1; // clean epoch inside gloas
const SEG1_SLOT = EPOCH0 * SLOTS_PER_EPOCH;
const SEG2_SLOT = (EPOCH0 + 1) * SLOTS_PER_EPOCH;

function el(root: RootHex, slot: Slot, overrides: Partial<HeaderChainElement> = {}): HeaderChainElement {
  return {
    root,
    parentRoot: "0xparent",
    slot,
    // EMPTY threading by default: a unique own blockHash with a shared parentBlockHash means
    // child.parentBlockHash !== el.blockHash → isFull=false → never needsEnvelope.
    blockHash: `0xbh-${root}`,
    parentBlockHash: "0xexec",
    blobCount: 0,
    ...overrides,
  };
}

/** Two-epoch, four-element bottom-first chain: [a, b] in epoch0, [c, target] in epoch0+1. */
function twoEpochChain(): HeaderChainElement[] {
  return [el("0xa", SEG1_SLOT), el("0xb", SEG1_SLOT + 1), el("0xc", SEG2_SLOT), el("0xtarget", SEG2_SLOT + 1)];
}

function makeTarget(headerChain: HeaderChainElement[], spillBlocks?: Map<RootHex, unknown>): Target {
  const blocks = spillBlocks ?? new Map(headerChain.map((e) => [e.root, {message: {slot: e.slot}}]));
  return {
    root: (headerChain.at(-1) as HeaderChainElement).root,
    slotHint: undefined,
    kind: "head",
    status: {kind: "importing"},
    advocates: new Map([["adv", (headerChain.at(-1) as HeaderChainElement).root]]),
    waiters: [],
    headerChain,
    walkAnchor: "0xintersection",
    provenance: new Map(),
    intersectionRoot: "0xintersection",
    attempts: {walk: 0, import: 0},
    spillBytes: 0,
    createdAtMs: 0,
    spill: {
      get: vi.fn(async (root: RootHex) => blocks.get(root) ?? null),
      put: vi.fn(async () => {}),
      deleteUpToSlot: vi.fn(async () => {}),
    } as unknown as Target["spill"],
  };
}

function makeHarness(opts: {
  inForkChoice?: Set<RootHex>;
  currentEpoch?: number;
  lineageSatisfied?: boolean;
  payloadInputs?: Map<RootHex, unknown>;
  localParentBlock?: unknown;
  peers?: PeerIdStr[];
}) {
  const inForkChoice = opts.inForkChoice ?? new Set<RootHex>();
  const payloadInputs = opts.payloadInputs ?? new Map<RootHex, unknown>();
  const processChainSegment = vi.fn(async (...args: unknown[]) => {
    for (const b of args[0] as {blockRootHex: RootHex}[]) inForkChoice.add(b.blockRootHex);
  });

  const chain = {
    processChainSegment,
    forkChoice: {
      hasBlockHex: (root: RootHex) => inForkChoice.has(root),
      getBlockHexAndBlockHash: vi.fn(() => (opts.lineageSatisfied !== false ? {} : null)),
    },
    clock: {currentEpoch: opts.currentEpoch ?? EPOCH0 + 1},
    seenBlockInputCache: {
      getByBlock: vi.fn(({blockRootHex}: {blockRootHex: RootHex}) => ({
        blockRootHex,
        hasBlockAndAllData: () => true,
      })),
    },
    seenPayloadEnvelopeInputCache: {get: vi.fn((root: RootHex) => payloadInputs.get(root))},
    getBlockByRoot: vi.fn(async () => opts.localParentBlock ?? null),
    custodyConfig: {sampledColumns: [], custodyColumns: []},
  } as unknown as IBeaconChain;

  const abort = new AbortController();
  const deps: ImporterDeps = {
    config,
    chain,
    network: {} as ImporterDeps["network"],
    ledger: new QuotaLedger(
      defaultQuotaLimits({
        MAX_REQUEST_BLOCKS_DENEB: 128,
        MAX_REQUEST_DATA_COLUMN_SIDECARS: 16384,
        MAX_REQUEST_PAYLOADS: 128,
      })
    ),
    connectedPeers: () => opts.peers ?? ["p1"],
    reportPeer: vi.fn(),
    signal: abort.signal,
  };
  return {deps, chain, processChainSegment, inForkChoice, abort};
}

describe("sync / target / importer", () => {
  function spyDataFill(): void {
    vi.spyOn(dataFillModule, "dataFill").mockResolvedValue({filled: 0, deferred: 0});
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("imports one epoch segment per call [A6]; releases spill per segment; completes at the top", async () => {
    spyDataFill();
    const target = makeTarget(twoEpochChain());
    const h = makeHarness({});

    const first = await importNextSegment(target, h.deps);
    expect(first).toEqual({step: "segmentImported", upToSlot: SEG1_SLOT + 1, done: false});
    expect(h.processChainSegment).toHaveBeenCalledTimes(1);
    const seg1Blocks = h.processChainSegment.mock.calls[0][0] as {blockRootHex: RootHex}[];
    expect(seg1Blocks.map((b) => b.blockRootHex)).toEqual(["0xa", "0xb"]);
    expect(target.spill.deleteUpToSlot).toHaveBeenCalledWith(SEG1_SLOT + 1, h.deps.signal);
    expect(target.importCursor).toBe(2);

    const second = await importNextSegment(target, h.deps);
    expect(second).toEqual({step: "completed"});
    const seg2Blocks = h.processChainSegment.mock.calls[1][0] as {blockRootHex: RootHex}[];
    expect(seg2Blocks.map((b) => b.blockRootHex)).toEqual(["0xc", "0xtarget"]);
  });

  it("gossip race: target already in fork choice → completed without touching the chain", async () => {
    spyDataFill();
    const target = makeTarget(twoEpochChain());
    const h = makeHarness({inForkChoice: new Set(["0xtarget"])});

    expect(await importNextSegment(target, h.deps)).toEqual({step: "completed"});
    expect(h.processChainSegment).not.toHaveBeenCalled();
  });

  it("re-derives the cursor from fork choice (partial-import recovery)", async () => {
    spyDataFill();
    const target = makeTarget(twoEpochChain());
    // First segment already landed (previous run / gossip).
    const h = makeHarness({inForkChoice: new Set(["0xa", "0xb"])});

    const res = await importNextSegment(target, h.deps);
    expect(res).toEqual({step: "completed"});
    const blocks = h.processChainSegment.mock.calls[0][0] as {blockRootHex: RootHex}[];
    expect(blocks.map((b) => b.blockRootHex)).toEqual(["0xc", "0xtarget"]);
  });

  it("notReady when a segment block is missing from the spill — nothing submitted", async () => {
    spyDataFill();
    const chain = twoEpochChain();
    const spillBlocks = new Map(chain.slice(1).map((e) => [e.root, {message: {slot: e.slot}} as unknown]));
    const target = makeTarget(chain, spillBlocks); // 0xa missing
    const h = makeHarness({});

    expect(await importNextSegment(target, h.deps)).toEqual({step: "notReady"});
    expect(h.processChainSegment).not.toHaveBeenCalled();
  });

  it("poison-map regression: an incomplete NEEDED envelope defers instead of killing the target", async () => {
    spyDataFill();
    // 0xa is gloas-FULL under 0xb (child.parentBlockHash === a.blockHash) → needsEnvelope.
    const chain = [
      el("0xa", SEG1_SLOT, {blockHash: "0xfull"}),
      el("0xb", SEG1_SLOT + 1, {parentBlockHash: "0xfull"}),
      el("0xtarget", SEG2_SLOT),
    ];
    const target = makeTarget(chain);
    // Envelope input exists but is INCOMPLETE (payload present, columns missing).
    const h = makeHarness({
      payloadInputs: new Map([
        [
          "0xa",
          {slot: SEG1_SLOT, hasPayloadEnvelope: () => true, hasComputedAllData: () => false, isComplete: () => false},
        ],
      ]),
    });

    expect(await importNextSegment(target, h.deps)).toEqual({step: "notReady"});
    expect(h.processChainSegment).not.toHaveBeenCalled();
  });

  it("includes COMPLETE envelope inputs in the map keyed by slot", async () => {
    spyDataFill();
    const chain = [
      el("0xa", SEG1_SLOT, {blockHash: "0xfull"}),
      el("0xb", SEG1_SLOT + 1, {parentBlockHash: "0xfull"}),
      el("0xtarget", SEG2_SLOT),
    ];
    const target = makeTarget(chain);
    const complete = {
      slot: SEG1_SLOT,
      hasPayloadEnvelope: () => true,
      hasComputedAllData: () => true,
      isComplete: () => true,
    };
    const h = makeHarness({payloadInputs: new Map([["0xa", complete]])});

    await importNextSegment(target, h.deps);
    const map = h.processChainSegment.mock.calls[0][1] as Map<Slot, unknown>;
    expect(map.get(SEG1_SLOT)).toBe(complete);
  });

  it("importAttestations: Skip for deep segments, import for recent ones", async () => {
    spyDataFill();
    // Deep: currentEpoch far above the segment epoch.
    const deepTarget = makeTarget(twoEpochChain());
    const deep = makeHarness({currentEpoch: EPOCH0 + 10});
    await importNextSegment(deepTarget, deep.deps);
    expect((deep.processChainSegment.mock.calls[0][2] as {importAttestations?: unknown}).importAttestations).toBe(
      AttestationImportOpt.Skip
    );

    // Recent: segment epoch >= currentEpoch - 1.
    const nearTarget = makeTarget(twoEpochChain());
    const near = makeHarness({currentEpoch: EPOCH0 + 1});
    await importNextSegment(nearTarget, near.deps);
    expect(
      (near.processChainSegment.mock.calls[0][2] as {importAttestations?: unknown}).importAttestations
    ).toBeUndefined();
  });

  describe("error classification", () => {
    async function failWith(code: BlockErrorCode, blockSlot = SEG1_SLOT) {
      spyDataFill();
      const target = makeTarget(twoEpochChain());
      const h = makeHarness({});
      const {block} = generateBlock({forkName: ForkName.gloas, slot: blockSlot});
      h.processChainSegment.mockRejectedValueOnce(new BlockError(block, {code} as never));
      return {res: await importNextSegment(target, h.deps), block};
    }

    it("consensus-invalid → invalid with the EXACT failing block root [A3]", async () => {
      const {res, block} = await failWith(BlockErrorCode.INVALID_SIGNATURE);
      const expectedRoot = toRootHex(config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message));
      expect(res).toEqual({step: "invalid", firstInvalidRoot: expectedRoot, reason: BlockErrorCode.INVALID_SIGNATURE});
    });

    it("chain-scope invalid → whole chain implicated (null root)", async () => {
      const {res} = await failWith(BlockErrorCode.NOT_FINALIZED_DESCENDANT);
      expect(res).toEqual({
        step: "invalid",
        firstInvalidRoot: null,
        reason: BlockErrorCode.NOT_FINALIZED_DESCENDANT,
      });
    });

    it("EL down → park elOffline; parent payload → parkParentPayload; finalization race → reanchor", async () => {
      expect((await failWith(BlockErrorCode.EXECUTION_ENGINE_ERROR)).res).toEqual({
        step: "park",
        reason: "elOffline",
      });
      expect((await failWith(BlockErrorCode.PARENT_PAYLOAD_UNKNOWN)).res).toEqual({
        step: "parkParentPayload",
        parentRoot: "0xparent",
      });
      expect((await failWith(BlockErrorCode.PARENT_UNKNOWN)).res).toEqual({step: "reanchor"});
    });

    it("non-BlockError → internal (never kills the target silently)", async () => {
      spyDataFill();
      const target = makeTarget(twoEpochChain());
      const h = makeHarness({});
      h.processChainSegment.mockRejectedValueOnce(new Error("regen exploded"));
      expect(await importNextSegment(target, h.deps)).toEqual({step: "internal", reason: "regen exploded"});
    });
  });

  it("R7 pin: processChainSegment resolving WITHOUT the blocks landing is never progress", async () => {
    spyDataFill();
    const target = makeTarget(twoEpochChain());
    const h = makeHarness({});
    h.processChainSegment.mockImplementationOnce(async () => {}); // absent-without-error
    expect(await importNextSegment(target, h.deps)).toEqual({
      step: "internal",
      reason: "segment_absent_after_import",
    });
    expect(target.spill.deleteUpToSlot).not.toHaveBeenCalled();
  });

  describe("bottom-parent payload seeding (gloas prime)", () => {
    it("cached complete envelope is injected at the parent slot without any fetch", async () => {
      spyDataFill();
      const target = makeTarget(twoEpochChain());
      const parentInput = {
        slot: SEG1_SLOT - 1,
        hasPayloadEnvelope: () => true,
        hasComputedAllData: () => true,
        isComplete: () => true,
      };
      const h = makeHarness({
        lineageSatisfied: false, // parent payload NOT in fork choice
        payloadInputs: new Map([["0xintersection", parentInput]]),
      });

      await importNextSegment(target, h.deps);
      const map = h.processChainSegment.mock.calls[0][1] as Map<Slot, unknown>;
      expect(map.get(SEG1_SLOT - 1)).toBe(parentInput);
      expect(h.chain.getBlockByRoot).not.toHaveBeenCalled();
    });

    it("prime miss (no local block, no eligible peer) → parkParentPayload", async () => {
      spyDataFill();
      const target = makeTarget(twoEpochChain());
      const h = makeHarness({lineageSatisfied: false, peers: []});

      expect(await importNextSegment(target, h.deps)).toEqual({
        step: "parkParentPayload",
        parentRoot: "0xintersection",
      });
      expect(h.processChainSegment).not.toHaveBeenCalled();
    });

    it("prime skipped entirely when the lineage is satisfied in fork choice", async () => {
      spyDataFill();
      const target = makeTarget(twoEpochChain());
      const h = makeHarness({lineageSatisfied: true});

      await importNextSegment(target, h.deps);
      expect(h.chain.getBlockByRoot).not.toHaveBeenCalled();
      const map = h.processChainSegment.mock.calls[0][1] as Map<Slot, unknown>;
      expect(map.size).toBe(0);
    });
  });

  it("abort: pre-aborted signal → aborted, nothing submitted", async () => {
    spyDataFill();
    const target = makeTarget(twoEpochChain());
    const h = makeHarness({});
    h.abort.abort();
    expect(await importNextSegment(target, h.deps)).toEqual({step: "aborted"});
    expect(h.processChainSegment).not.toHaveBeenCalled();
  });
});
