import {afterEach, describe, expect, it, vi} from "vitest";
import {testLogger} from "@lodestar/logger/test-utils";
import {ForkName} from "@lodestar/params";
import {RootHex} from "@lodestar/types";
import {PayloadError, PayloadErrorCode} from "../../../../src/chain/blocks/importExecutionPayload.js";
import {BlockError, BlockErrorCode} from "../../../../src/chain/errors/blockError.js";
import {IBeaconChain} from "../../../../src/chain/interface.js";
import * as dataFillModule from "../../../../src/sync/target/dataFill.js";
import * as fetchEnvelopeModule from "../../../../src/sync/target/fetchEnvelopeByRoot.js";
import {
  FILL_ESCALATION_ATTEMPTS_MAX,
  FILL_POOL_MAX_ACTIVE,
  FillPool,
  FillPoolDeps,
} from "../../../../src/sync/target/fillPool.js";
import {QuotaLedger, defaultQuotaLimits} from "../../../../src/sync/target/quotaLedger.js";
import * as downloadByRootModule from "../../../../src/sync/utils/downloadByRoot.js";
import {config, generateBlock, slots} from "../../../utils/blocksAndData.js";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const GLOAS_SLOT = slots.gloas + 5;

async function until(cond: () => boolean, ms = 500): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("until: timeout");
    await new Promise((r) => setTimeout(r, 1));
  }
}

function makeHarness(opts: {
  localBlocks?: Map<RootHex, unknown>;
  payloadInputs?: Map<RootHex, unknown>;
  inForkChoice?: Set<RootHex>;
  peers?: string[];
  escalate?: (root: RootHex) => boolean;
}) {
  const processExecutionPayload = vi.fn(async () => {});
  const processBlock = vi.fn(async () => {});
  const chain = {
    getBlockByRoot: vi.fn(async (root: RootHex) => {
      const block = opts.localBlocks?.get(root);
      return block !== undefined ? {block} : null;
    }),
    seenPayloadEnvelopeInputCache: {get: vi.fn((root: RootHex) => opts.payloadInputs?.get(root))},
    forkChoice: {hasBlockHex: (root: RootHex) => opts.inForkChoice?.has(root) ?? false},
    processExecutionPayload,
    processBlock,
    custodyConfig: {sampledColumns: [], custodyColumns: []},
  } as unknown as IBeaconChain;

  const reportPeer = vi.fn();
  const onBlockFetched = vi.fn();
  const onPayloadProcessed = vi.fn();
  const escalate = vi.fn(opts.escalate ?? (() => false));
  const abort = new AbortController();

  const deps: FillPoolDeps = {
    config,
    chain,
    network: {} as FillPoolDeps["network"],
    ledger: new QuotaLedger(
      defaultQuotaLimits({
        MAX_REQUEST_BLOCKS_DENEB: 128,
        MAX_REQUEST_DATA_COLUMN_SIDECARS: 16384,
        MAX_REQUEST_PAYLOADS: 128,
      })
    ),
    connectedPeers: () => opts.peers ?? ["p1", "p2", "p3"],
    reportPeer,
    onBlockFetched,
    onPayloadProcessed,
    escalate,
    logger: testLogger(),
    signal: abort.signal,
  };
  const pool = new FillPool(deps);
  return {
    pool,
    deps,
    chain,
    processExecutionPayload,
    processBlock,
    reportPeer,
    onBlockFetched,
    onPayloadProcessed,
    escalate,
    abort,
  };
}

function completeInput(slot = GLOAS_SLOT): {
  slot: number;
  hasPayloadEnvelope: () => boolean;
  hasComputedAllData: () => boolean;
  isComplete: () => boolean;
} {
  return {slot, hasPayloadEnvelope: () => true, hasComputedAllData: () => true, isComplete: () => true};
}

describe("sync / target / fillPool", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("THE HOLE, closed: envelope fill for an imported-PENDING block fetches, admits, and PROCESSES the payload", async () => {
    const {block} = generateBlock({forkName: ForkName.gloas, slot: GLOAS_SLOT});
    const input = completeInput();
    // After admission the cache returns a complete input.
    const h = makeHarness({
      localBlocks: new Map([["0xpending", block]]),
      payloadInputs: new Map([["0xpending", input]]),
    });
    const fetchSpy = vi
      .spyOn(fetchEnvelopeModule, "fetchAndValidateExecutionPayloadEnvelopeByRoot")
      .mockResolvedValue({result: "ADMITTED", warnings: null});

    h.pool.submit({kind: "envelope", root: "0xpending"});
    await until(() => h.pool.stats.active === 0);

    // The cached input already had the envelope, so no fetch was needed — processing ran.
    expect(h.processExecutionPayload).toHaveBeenCalledWith(input);

    // Now the fetch path: no cached input initially, admitted on fetch.
    const inputs = new Map<RootHex, unknown>();
    const h2 = makeHarness({localBlocks: new Map([["0xp2", block]]), payloadInputs: inputs});
    fetchSpy.mockImplementation(async () => {
      inputs.set("0xp2", completeInput());
      return {result: "ADMITTED", warnings: null};
    });
    h2.pool.submit({kind: "envelope", root: "0xp2"});
    await until(() => h2.pool.stats.active === 0);
    expect(fetchSpy).toHaveBeenCalled();
    expect(h2.processExecutionPayload).toHaveBeenCalled();
  });

  it("waitingForBlock [A5]: slotless park, woken by onBlockKnown", async () => {
    const {block} = generateBlock({forkName: ForkName.gloas, slot: GLOAS_SLOT});
    const localBlocks = new Map<RootHex, unknown>();
    const input = completeInput();
    const h = makeHarness({localBlocks, payloadInputs: new Map([["0xlate", input]])});

    h.pool.submit({kind: "envelope", root: "0xlate"});
    await until(() => h.pool.stats.waiting === 1);
    expect(h.pool.stats.active).toBe(0); // parked WITHOUT holding a slot

    // Block arrives (imported) → wake → this time the block is local → processed.
    localBlocks.set("0xlate", block);
    h.pool.onBlockKnown("0xlate");
    await until(() => h.pool.stats.active === 0 && h.pool.stats.waiting === 0);
    expect(h.processExecutionPayload).toHaveBeenCalledWith(input);
  });

  it("escalation budget [A13]: rejected escalations retry per slot, then drop; accepted escalation hands off", async () => {
    const h = makeHarness({escalate: () => false});
    h.pool.submit({kind: "envelope", root: "0xnoblock"});
    await until(() => h.pool.stats.waiting === 1);

    for (let i = 0; i < FILL_ESCALATION_ATTEMPTS_MAX; i++) {
      expect(h.pool.stats.waiting).toBe(1);
      h.pool.onSlot();
    }
    expect(h.pool.stats.waiting).toBe(0); // dropped after budget
    expect(h.escalate).toHaveBeenCalledTimes(FILL_ESCALATION_ATTEMPTS_MAX);

    // Accepted escalation removes the parked fill immediately (a target owns it now).
    const h2 = makeHarness({escalate: () => true});
    h2.pool.submit({kind: "envelope", root: "0xother"});
    await until(() => h2.pool.stats.waiting === 1);
    h2.pool.onSlot();
    expect(h2.pool.stats.waiting).toBe(0);
    expect(h2.escalate).toHaveBeenCalledTimes(1);
  });

  it("concurrency cap + dedupe + queue drain", async () => {
    // Enough peers that per-peer in-flight caps (2 per protocol) never bind for 10 tasks.
    const h = makeHarness({peers: Array.from({length: 12}, (_, i) => `peer${i}`)});
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    vi.spyOn(downloadByRootModule, "fetchAndValidateBlock").mockImplementation(async () => {
      await gate;
      return generateBlock({forkName: ForkName.gloas, slot: GLOAS_SLOT}).block as never;
    });

    for (let i = 0; i < FILL_POOL_MAX_ACTIVE + 2; i++) {
      h.pool.submit({kind: "block", root: `0xb${i}`});
    }
    // Duplicates are ignored.
    h.pool.submit({kind: "block", root: "0xb0"});

    expect(h.pool.stats.active).toBe(FILL_POOL_MAX_ACTIVE);
    expect(h.pool.stats.queued).toBe(2);

    release();
    await until(() => h.pool.stats.active === 0 && h.pool.stats.queued === 0);
    expect(h.onBlockFetched).toHaveBeenCalledTimes(FILL_POOL_MAX_ACTIVE + 2);
  });

  it("block fetch: root mismatch scores + rotates; success routes to the facade", async () => {
    const h = makeHarness({});
    const {block} = generateBlock({forkName: ForkName.gloas, slot: GLOAS_SLOT});
    const fetch = vi
      .spyOn(downloadByRootModule, "fetchAndValidateBlock")
      .mockRejectedValueOnce(
        new downloadByRootModule.DownloadByRootError({
          code: downloadByRootModule.DownloadByRootErrorCode.MISMATCH_BLOCK_ROOT,
          peer: "p1",
          blockRoot: "0xwant",
          receivedBlockRoot: "0xgot",
        } as never)
      )
      .mockResolvedValueOnce(block as never);

    h.pool.submit({kind: "block", root: "0xwant"});
    await until(() => h.pool.stats.active === 0);

    expect(h.reportPeer).toHaveBeenCalledWith(expect.any(String), "block_root_mismatch");
    expect(fetch).toHaveBeenCalledTimes(2); // rotated to a second peer
    expect(h.onBlockFetched).toHaveBeenCalledWith("0xwant", block, expect.any(String));
  });

  it("envelope REJECTED → serving peer scored, rotation continues", async () => {
    const {block} = generateBlock({forkName: ForkName.gloas, slot: GLOAS_SLOT});
    const inputs = new Map<RootHex, unknown>();
    const h = makeHarness({localBlocks: new Map([["0xaa", block]]), payloadInputs: inputs});
    vi.spyOn(fetchEnvelopeModule, "fetchAndValidateExecutionPayloadEnvelopeByRoot")
      .mockResolvedValueOnce({result: "REJECTED", warnings: null})
      .mockImplementationOnce(async () => {
        inputs.set("0xaa", completeInput());
        return {result: "ADMITTED", warnings: null};
      });

    h.pool.submit({kind: "envelope", root: "0xaa"});
    await until(() => h.pool.stats.active === 0);

    expect(h.reportPeer).toHaveBeenCalledWith(expect.any(String), "ENVELOPE_REJECTED");
    expect(h.processExecutionPayload).toHaveBeenCalled();
  });

  it("envelope with missing columns chains into a columns task before processing", async () => {
    const {block} = generateBlock({forkName: ForkName.gloas, slot: GLOAS_SLOT});
    // Envelope present but columns incomplete → chained columns fill → complete → process.
    let complete = false;
    const input = {
      slot: GLOAS_SLOT,
      hasPayloadEnvelope: () => true,
      hasComputedAllData: () => complete,
      isComplete: () => complete,
    };
    const h = makeHarness({localBlocks: new Map([["0xc", block]]), payloadInputs: new Map([["0xc", input]])});
    vi.spyOn(dataFillModule, "dataFill").mockImplementation(async () => {
      complete = true; // the columns pass completes the input
      return {filled: 1, deferred: 0};
    });

    h.pool.submit({kind: "envelope", root: "0xc"});
    await until(() => h.pool.stats.active === 0 && h.processExecutionPayload.mock.calls.length > 0);
    expect(h.processExecutionPayload).toHaveBeenCalledWith(input);
  });

  it("fulu block-input completion → processBlock; PARENT_UNKNOWN escalates the parent with a waiter", async () => {
    const h = makeHarness({});
    vi.spyOn(dataFillModule, "dataFill").mockResolvedValue({filled: 1, deferred: 0});
    const {block} = generateBlock({forkName: ForkName.fulu, slot: slots.fulu + 1});

    const blockInput = {
      blockRootHex: "0xf",
      parentRootHex: "0xfparent",
      hasBlock: () => true,
      getBlock: () => block,
      hasBlockAndAllData: () => true,
    };
    h.pool.submit({kind: "columns", root: "0xf", input: blockInput as never, inputKind: "block"});
    await until(() => h.pool.stats.active === 0);
    expect(h.processBlock).toHaveBeenCalledWith(blockInput, {ignoreIfKnown: true});

    // PARENT_UNKNOWN → escalate(parent) with this block as waiter.
    h.processBlock.mockRejectedValueOnce(
      new BlockError(block, {code: BlockErrorCode.PARENT_UNKNOWN, parentRoot: "0xfparent"})
    );
    h.pool.submit({
      kind: "columns",
      root: "0xf2",
      input: {...blockInput, blockRootHex: "0xf2"} as never,
      inputKind: "block",
    });
    await until(() => h.pool.stats.active === 0);
    expect(h.escalate).toHaveBeenCalledWith("0xfparent", {rootHex: "0xf2", peer: ""});
  });

  it("PayloadError BLOCK_NOT_IN_FORK_CHOICE re-parks the fill on the block", async () => {
    const {block} = generateBlock({forkName: ForkName.gloas, slot: GLOAS_SLOT});
    const input = completeInput();
    const h = makeHarness({localBlocks: new Map([["0xnb", block]]), payloadInputs: new Map([["0xnb", input]])});
    h.processExecutionPayload.mockRejectedValueOnce(
      new PayloadError({code: PayloadErrorCode.BLOCK_NOT_IN_FORK_CHOICE, blockRoot: "0xnb"} as never)
    );

    h.pool.submit({kind: "envelope", root: "0xnb"});
    await until(() => h.pool.stats.waiting === 1);
  });

  it("abort: submissions are no-ops after close", async () => {
    const h = makeHarness({});
    h.abort.abort();
    h.pool.submit({kind: "block", root: "0xa"});
    expect(h.pool.stats.active).toBe(0);
    expect(h.pool.stats.queued).toBe(0);
  });
});
