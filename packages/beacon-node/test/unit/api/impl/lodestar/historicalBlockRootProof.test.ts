import {beforeEach, describe, expect, it} from "vitest";
import {routes} from "@lodestar/api";
import {createChainForkConfig} from "@lodestar/config";
import {config as defaultConfig} from "@lodestar/config/default";
import {SLOTS_PER_EPOCH, SLOTS_PER_HISTORICAL_ROOT} from "@lodestar/params";
import {Root, ssz} from "@lodestar/types";
import {toRootHex, verifyMerkleBranch} from "@lodestar/utils";
import {
  createBlockRootProof,
  fillPeriodBlockRoots,
  getHistoricalSummaryIndex,
} from "../../../../../src/api/impl/lodestar/historicalBlockRootProof.js";
import {getLodestarApi} from "../../../../../src/api/impl/lodestar/index.js";
import {ApiTestModules, getApiTestModules} from "../../../../utils/api.js";

const EPOCHS_PER_HISTORICAL_ROOT = SLOTS_PER_HISTORICAL_ROOT / SLOTS_PER_EPOCH;
const BLOCK_ROOTS_DEPTH = Math.log2(SLOTS_PER_HISTORICAL_ROOT);

const root = (byte: number): Root => new Uint8Array(32).fill(byte);

/** Archived blocks at every slot of the period except `skipped`, with distinct roots */
function archivedPeriod(periodStartSlot: number, skipped: number[]): {slot: number; root: Root}[] {
  const archived: {slot: number; root: Root}[] = [];
  for (let slot = periodStartSlot; slot < periodStartSlot + SLOTS_PER_HISTORICAL_ROOT; slot++) {
    if (!skipped.includes(slot)) {
      archived.push({slot, root: root(1 + (slot % 200))});
    }
  }
  return archived;
}

describe("getHistoricalSummaryIndex", () => {
  it.each([
    {capellaForkEpoch: 0, period: 0, index: 0},
    {capellaForkEpoch: 0, period: 5, index: 5},
    // transition into the fork epoch still writes historical_roots, the first summary covers the fork period
    {capellaForkEpoch: EPOCHS_PER_HISTORICAL_ROOT, period: 1, index: 0},
    {capellaForkEpoch: EPOCHS_PER_HISTORICAL_ROOT, period: 0, index: -1},
    // fork mid-period: the summary at the next period boundary covers the whole fork period
    {capellaForkEpoch: EPOCHS_PER_HISTORICAL_ROOT + 1, period: 1, index: 0},
    {capellaForkEpoch: 3 * EPOCHS_PER_HISTORICAL_ROOT - 1, period: 2, index: 0},
  ])("CAPELLA_FORK_EPOCH=$capellaForkEpoch period=$period -> $index", ({capellaForkEpoch, period, index}) => {
    const config = createChainForkConfig({...defaultConfig, CAPELLA_FORK_EPOCH: capellaForkEpoch});
    expect(getHistoricalSummaryIndex(config, period)).toBe(index);
  });
});

describe("fillPeriodBlockRoots", () => {
  const periodStartSlot = 3 * SLOTS_PER_HISTORICAL_ROOT;

  it("carries the latest root into skipped slots", () => {
    const skipped = [periodStartSlot + 2, periodStartSlot + 3, periodStartSlot + SLOTS_PER_HISTORICAL_ROOT - 1];
    const archived = archivedPeriod(periodStartSlot, skipped);
    const blockRoots = fillPeriodBlockRoots(periodStartSlot, root(255), archived);
    expect(blockRoots).not.toBeNull();
    expect(blockRoots).toHaveLength(SLOTS_PER_HISTORICAL_ROOT);
    for (const {slot, root} of archived) {
      expect(toRootHex(blockRoots?.[slot - periodStartSlot] as Root), `slot ${slot}`).toBe(toRootHex(root));
    }
    for (const slot of skipped) {
      const latest = archived.filter((b) => b.slot < slot).at(-1)?.root as Root;
      expect(toRootHex(blockRoots?.[slot - periodStartSlot] as Root), `skipped slot ${slot}`).toBe(toRootHex(latest));
    }
  });

  it("uses the root before the period when its first slot is skipped", () => {
    const archived = archivedPeriod(periodStartSlot, [periodStartSlot]);
    const blockRoots = fillPeriodBlockRoots(periodStartSlot, root(255), archived);
    expect(toRootHex(blockRoots?.[0] as Root)).toBe(toRootHex(root(255)));
    expect(toRootHex(blockRoots?.[1] as Root)).toBe(toRootHex(archived[0].root));
  });

  it("returns null when the first slot is skipped and the previous root is unknown", () => {
    const archived = archivedPeriod(periodStartSlot, [periodStartSlot]);
    expect(fillPeriodBlockRoots(periodStartSlot, null, archived)).toBeNull();
  });

  it("does not need the previous root when the first slot has a block", () => {
    const archived = archivedPeriod(periodStartSlot, []);
    expect(fillPeriodBlockRoots(periodStartSlot, null, archived)).toHaveLength(SLOTS_PER_HISTORICAL_ROOT);
  });
});

describe("createBlockRootProof", () => {
  it("proves the block root against the block_roots vector root", () => {
    const blockRoots = Array.from({length: SLOTS_PER_HISTORICAL_ROOT}, (_, i) => root(i % 256));
    const expectedRoot = ssz.phase0.HistoricalBlockRoots.hashTreeRoot(blockRoots);
    for (const index of [0, 1, SLOTS_PER_HISTORICAL_ROOT / 2, SLOTS_PER_HISTORICAL_ROOT - 1]) {
      const {blockRoot, blockSummaryRoot, proof} = createBlockRootProof(blockRoots, index);
      expect(toRootHex(blockRoot), `index ${index}`).toBe(toRootHex(blockRoots[index]));
      expect(toRootHex(blockSummaryRoot), `index ${index}`).toBe(toRootHex(expectedRoot));
      expect(proof, `index ${index}`).toHaveLength(BLOCK_ROOTS_DEPTH);
      expect(verifyMerkleBranch(blockRoot, proof, BLOCK_ROOTS_DEPTH, index, expectedRoot), `index ${index}`).toBe(true);
    }
  });
});

describe("getHistoricalBlockRootProof", () => {
  let modules: ApiTestModules;
  let api: ReturnType<typeof getLodestarApi>;
  const period = 2;
  const periodStartSlot = period * SLOTS_PER_HISTORICAL_ROOT;
  const archived = archivedPeriod(periodStartSlot, [periodStartSlot + 5]);
  const blockRoots = fillPeriodBlockRoots(periodStartSlot, null, archived) as Root[];
  const blockSummaryRoot = ssz.phase0.HistoricalBlockRoots.hashTreeRoot(blockRoots);

  beforeEach(() => {
    const config = createChainForkConfig({...defaultConfig, CAPELLA_FORK_EPOCH: 0});
    modules = getApiTestModules({config});
    api = getLodestarApi(modules);
    const historicalSummaries = [0, 1, 2].map((i) => ({
      blockSummaryRoot: i === period ? blockSummaryRoot : root(100 + i),
      stateSummaryRoot: root(200 + i),
    }));
    modules.chain.getHeadState.mockReturnValue({forkName: "capella", historicalSummaries} as never);
    modules.db.blockArchive.getLatestRootBeforeSlot.mockResolvedValue(null);
    modules.db.blockArchive.getRootsBySlotRange.mockResolvedValue(archived);
  });

  it("returns the root and branch for an archived slot", async () => {
    const slot = periodStartSlot + 5;
    const data = (await api.getHistoricalBlockRootProof({slot})).data as routes.lodestar.HistoricalBlockRootProof;
    expect(data.slot).toBe(slot);
    expect(data.historicalSummaryIndex).toBe(period);
    expect(toRootHex(data.blockRoot)).toBe(toRootHex(blockRoots[5]));
    expect(toRootHex(data.blockSummaryRoot)).toBe(toRootHex(blockSummaryRoot));
    expect(verifyMerkleBranch(data.blockRoot, data.proof, BLOCK_ROOTS_DEPTH, 5, blockSummaryRoot)).toBe(true);
    expect(modules.db.blockArchive.getRootsBySlotRange).toHaveBeenCalledWith(
      periodStartSlot,
      periodStartSlot + SLOTS_PER_HISTORICAL_ROOT
    );
  });

  it("rejects a slot without a historical summary", async () => {
    await expect(api.getHistoricalBlockRootProof({slot: 3 * SLOTS_PER_HISTORICAL_ROOT})).rejects.toThrow(
      "not covered by a historical summary"
    );
  });

  it("rejects a period the block archive does not cover", async () => {
    modules.db.blockArchive.getRootsBySlotRange.mockResolvedValue(archived.slice(1));
    await expect(api.getHistoricalBlockRootProof({slot: periodStartSlot + 5})).rejects.toThrow("does not cover slot");
  });

  it("rejects a period whose archived roots do not match the summary", async () => {
    modules.db.blockArchive.getRootsBySlotRange.mockResolvedValue(archived.slice(0, -1));
    await expect(api.getHistoricalBlockRootProof({slot: periodStartSlot + 5})).rejects.toThrow(
      "do not match historical summary 2"
    );
  });
});
