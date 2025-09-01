import {readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {assert, beforeAll, describe, it} from "vitest";

import {ChainForkConfig, createChainForkConfig} from "@lodestar/config";
import {config as defaultConfig} from "@lodestar/config/default";
import {getEraIndexes, readBeaconBlockFromEra, readBeaconStateFromEra, readBlocksFromEra} from "../../src/index.js";

import {SLOTS_PER_HISTORICAL_ROOT} from "@lodestar/params";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe.runIf(!process.env.CI)("era file (integration)", () => {
  let data: Uint8Array;
  let cfg: ChainForkConfig;
  const eraPath = path.resolve(__dirname, "../mainnet-01506-4781865b.era");
  const expectedEra = 1506;
  const stateStartSlot = expectedEra * SLOTS_PER_HISTORICAL_ROOT;
  const blockStartSlot = stateStartSlot - SLOTS_PER_HISTORICAL_ROOT;

  beforeAll(() => {
    try {
      data = new Uint8Array(readFileSync(eraPath));
    } catch {
      throw new Error(". Run the downloader script first:\n  ./packages/era/test/era_downloader.sh\n");
    }
    cfg = createChainForkConfig(defaultConfig);
  });

  // Low-level entry and raw index checks are covered in unit tests

  it("getEraIndexes returns aligned block and state indices", () => {
    const idx = getEraIndexes(data, expectedEra);
    assert.equal(Number(idx.stateSlotIndex.startSlot), stateStartSlot);
    if (!idx.blockSlotIndex) throw new Error("blockSlotIndex is undefined");
    assert.equal(Number(idx.blockSlotIndex.startSlot), blockStartSlot);
  });

  it("readBeaconStateFromEra decodes state for the expected era", () => {
    const state = readBeaconStateFromEra(data, cfg, expectedEra);
    assert.equal(Number(state.slot), stateStartSlot);
  });

  it("readBeaconStateFromEra infers the era when not provided", () => {
    const state = readBeaconStateFromEra(data, cfg);
    assert.equal(Number(state.slot), stateStartSlot);
  });

  it("readBeaconBlockFromEra decodes a non-empty block by offset", () => {
    const {blockSlotIndex} = getEraIndexes(data, expectedEra);
    if (!blockSlotIndex) throw new Error("blockSlotIndex is undefined");
    const idx = blockSlotIndex.offsets.findIndex((o) => o !== 0);
    if (idx === -1) throw new Error("no non-empty block slots found in this era");
    const block = readBeaconBlockFromEra(data, idx, cfg, expectedEra);
    assert.equal(Number(block.message.slot), blockSlotIndex.startSlot + idx);
  });

  it("readBeaconBlockFromEra works without expectedEra", () => {
    const {blockSlotIndex} = getEraIndexes(data, expectedEra);
    if (!blockSlotIndex) throw new Error("blockSlotIndex is undefined");
    const idx = blockSlotIndex.offsets.findIndex((o) => o !== 0);
    if (idx === -1) throw new Error("no non-empty block slots found in this era");
    const block = readBeaconBlockFromEra(data, idx, cfg);
    assert.equal(Number(block.message.slot), blockSlotIndex.startSlot + idx);
  });

  it("readBlocksFromEra yields at least one block in order", () => {
    const {blockSlotIndex} = getEraIndexes(data, expectedEra);
    if (!blockSlotIndex) throw new Error("blockSlotIndex is undefined");
    const firstIdx = blockSlotIndex.offsets.findIndex((o) => o !== 0);
    if (firstIdx === -1) throw new Error("no non-empty block slots found in this era");
    const it = readBlocksFromEra(data, cfg, expectedEra);
    const first = it.next();
    assert.equal(first.done, false);
    if (!first.done) {
      assert.equal(Number(first.value.message.slot), blockSlotIndex.startSlot + firstIdx);
    }
  });
});
