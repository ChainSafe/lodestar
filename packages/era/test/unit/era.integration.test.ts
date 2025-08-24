import {readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {assert, beforeAll, describe, it} from "vitest";

import {E2STORE_HEADER_SIZE, E2StoreEntryType, getEraIndexes, readEntry, readSlotIndex} from "../../lib/index.js";

import {SLOTS_PER_HISTORICAL_ROOT} from "@lodestar/params";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe.runIf(!process.env.CI)("era file (integration)", () => {
  let data: Uint8Array;
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
  });

  it("first entry is Version", () => {
    const entry = readEntry(data);
    assert.equal(entry.type, E2StoreEntryType.Version);
    assert.equal(entry.data.length, 0);
  });

  it("second and third entries are blocks", () => {
    let p = 0;
    const e1 = readEntry(data);
    p += E2STORE_HEADER_SIZE + e1.data.length;
    const e2 = readEntry(data.slice(p));
    p += E2STORE_HEADER_SIZE + e2.data.length;
    const e3 = readEntry(data.slice(p));

    assert.equal(e2.type, E2StoreEntryType.CompressedSignedBeaconBlock);
    assert.equal(e3.type, E2StoreEntryType.CompressedSignedBeaconBlock);
  });

  it("reads the state slotIndex (count=1)", () => {
    const stateIndex = readSlotIndex(data, "state");
    assert.equal(stateIndex.offsets.length, 1);
    assert.equal(Number(stateIndex.startSlot), stateStartSlot);
  });

  it("getEraIndexes(): returns aligned block+state indices", () => {
    const idx = getEraIndexes(data, expectedEra);
    assert.equal(Number(idx.stateSlotIndex.startSlot), stateStartSlot);
    if (!idx.blockSlotIndex) throw new Error("blockSlotIndex is undefined");
    assert.equal(Number(idx.blockSlotIndex.startSlot), blockStartSlot);
  });
});
