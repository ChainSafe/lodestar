import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {assert, beforeAll, describe, it} from "vitest";

import {ChainForkConfig, createChainForkConfig} from "@lodestar/config";
import {config as defaultConfig} from "@lodestar/config/default";
import {SLOTS_PER_HISTORICAL_ROOT} from "@lodestar/params";
import {encodeSnappy} from "../../../reqresp/src/encodingStrategies/sszSnappy/snappyFrames/compress.js";

import {
  E2StoreEntryType,
  decompressBeaconState,
  decompressSignedBeaconBlock,
  getEraIndexes,
  readEntry,
  readI64LE,
  writeEraGroup,
} from "../../src/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe.runIf(!process.env.CI)("read original era and re-write our own era file", () => {
  let data: Uint8Array;
  let cfg: ChainForkConfig;
  const eraPath = path.resolve(__dirname, "../mainnet-01506-4781865b.era");
  const expectedEra = 1506;

  beforeAll(() => {
    try {
      data = new Uint8Array(readFileSync(eraPath));
    } catch {
      throw new Error(". Run the downloader script first:\n  ./packages/era/test/era_downloader.sh\n");
    }
    cfg = createChainForkConfig(defaultConfig);
  });

  let snappyTimeMs = 0;
  async function encodeSnappyToUint8Array(data: Uint8Array): Promise<Uint8Array> {
    const t0 = Date.now();
    const buffers: Buffer[] = [];
    for await (const chunk of encodeSnappy(Buffer.from(data.buffer, data.byteOffset, data.byteLength))) {
      buffers.push(chunk);
    }
    snappyTimeMs += Date.now() - t0;
    const total = buffers.reduce((n, b) => n + b.length, 0);
    const out = new Uint8Array(total);
    let p = 0;
    for (const b of buffers) {
      out.set(b, p);
      p += b.length;
    }
    return out;
  }
  const framedBySSZ = new WeakMap<Uint8Array, Uint8Array>();
  function snappyFramed(data: Uint8Array): Uint8Array {
    const out = framedBySSZ.get(data);
    if (!out) throw new Error("missing precomputed snappy frame for provided SSZ bytes");
    return out;
  }

  it("reads an existing era group and writes a full group that round-trips", async () => {
    console.log("stage: read+parse indexes");
    const {stateSlotIndex, blockSlotIndex} = getEraIndexes(data, expectedEra);

    // Build uncompressed SSZ for state from original file
    const stateOffset = stateSlotIndex.offsets[0];
    assert.ok(stateOffset > 0, "original state must exist");
    const stateEntry = readEntry(data.subarray(stateOffset));
    assert.equal(stateEntry.type, E2StoreEntryType.CompressedBeaconState);
    let scanDeserializeMs = 0;
    let serializeMs = 0;
    let tlvWriteMs = 0;

    console.log("stage: state decompress+serialize");
    // Decompress + deserialize state
    const stateValue = (() => {
      const t0 = Date.now();
      const v = decompressBeaconState(stateEntry.data, expectedEra, cfg);
      scanDeserializeMs += Date.now() - t0;
      return v;
    })();
    const stateSlot = stateSlotIndex.startSlot;
    const stateSSZ = (() => {
      const t0 = Date.now();
      const ssz = cfg.getForkTypes(stateSlot).BeaconState.serialize(stateValue);
      serializeMs += Date.now() - t0;
      return ssz;
    })();

    console.log("stage: scan+serialize blocks window");
    // Build all available blocks in the window as SSZ
    const SPR = SLOTS_PER_HISTORICAL_ROOT;
    const blocksBySlot = new Map<number, Uint8Array>();
    let originalNonEmpty = 0;
    let scanned = 0;
    if (blockSlotIndex) {
      for (let i = 0; i < blockSlotIndex.offsets.length; i++) {
        const abs = blockSlotIndex.offsets[i];
        scanned++;
        if (!abs) continue;
        originalNonEmpty++;
        const entry = readEntry(data.subarray(abs));
        if (entry.type !== E2StoreEntryType.CompressedSignedBeaconBlock) continue;
        const slot = blockSlotIndex.startSlot + i;
        const blockValue = (() => {
          const t0 = Date.now();
          const v = decompressSignedBeaconBlock(entry.data, slot, cfg);
          scanDeserializeMs += Date.now() - t0;
          return v;
        })();
        const blockSSZ = (() => {
          const t0 = Date.now();
          const ssz = cfg.getForkTypes(slot).SignedBeaconBlock.serialize(blockValue);
          serializeMs += Date.now() - t0;
          return ssz;
        })();
        blocksBySlot.set(slot, blockSSZ);

        if ((scanned & 0x1ff) === 0) {
          console.log(`progress: scanned ${scanned}/${SPR} slots, non-empty ${originalNonEmpty}`);
        }
      }
    }
    console.log("stage: precompute snappy frames (original encoder)");
    // Precompute snappy frames
    framedBySSZ.set(stateSSZ, await encodeSnappyToUint8Array(stateSSZ));
    for (const ssz of blocksBySlot.values()) {
      framedBySSZ.set(ssz, await encodeSnappyToUint8Array(ssz));
    }
    console.log(`stage: blocks prepared (non-empty=${originalNonEmpty})`);

    // Write a new era group and then a full era file with that single group
    console.log("stage: write group (snappy+TLV+index)");
    const groupBytes = (() => {
      const t0 = Date.now();
      const bytes = writeEraGroup({
        era: expectedEra,
        slotsPerHistoricalRoot: SPR,
        snappyFramed,
        blocksBySlot,
        stateSlot,
        stateSSZ,
      });
      tlvWriteMs += Date.now() - t0;
      return bytes;
    })();
    console.log(`stage: validate new group (bytes=${groupBytes.length})`);

    // Validate group round-trip
    const newIdx = getEraIndexes(groupBytes, expectedEra);
    assert.equal(newIdx.stateSlotIndex.startSlot, stateSlot);
    assert.equal(stateSlot, expectedEra * SPR);
    if (blockSlotIndex) {
      const bsi = newIdx.blockSlotIndex;
      assert.ok(bsi);
      assert.equal(bsi.startSlot, blockSlotIndex.startSlot);
      assert.equal(bsi.offsets.length, SPR);
      assert.equal(bsi.startSlot, stateSlot - SPR);
      const newNonEmpty = bsi.offsets.filter((o) => o !== 0).length;
      assert.equal(newNonEmpty, originalNonEmpty);
    } else {
      assert.equal(newIdx.blockSlotIndex, undefined);
    }

    // Validate state decodes from new file
    const newStateOffset = newIdx.stateSlotIndex.offsets[0];
    const newStateEntry = readEntry(groupBytes.subarray(newStateOffset));
    assert.equal(newStateEntry.type, E2StoreEntryType.CompressedBeaconState);
    const newState = decompressBeaconState(newStateEntry.data, expectedEra, cfg);
    assert.equal(Number(newState.slot), stateSlot);

    // State index: count=1, relative = headerStart - indexHeaderStart (header-start semantics)
    {
      const ssi = newIdx.stateSlotIndex;
      const ssiEntry = readEntry(groupBytes.subarray(ssi.recordStart));
      // startSlot(8) + offsets(8) + count(8)
      const recordedRel = readI64LE(ssiEntry.data, 8);
      const expectedRel = BigInt(newStateOffset - ssi.recordStart);
      assert.equal(recordedRel, expectedRel);
    }

    // Block index (if present): each non-zero offset obeys the same relation
    if (newIdx.blockSlotIndex) {
      const bsi = newIdx.blockSlotIndex;
      const bsiEntry = readEntry(groupBytes.subarray(bsi.recordStart));
      for (let i = 0; i < bsi.offsets.length; i++) {
        const headerStart = bsi.offsets[i];
        const rel = readI64LE(bsiEntry.data, 8 + i * 8);
        if (headerStart === 0) {
          assert.equal(rel, 0n);
        } else {
          const expectedRel = BigInt(headerStart - bsi.recordStart);
          assert.equal(rel, expectedRel);
        }
      }
    }

    // Validate first and last non-empty blocks decode from new file
    if (newIdx.blockSlotIndex) {
      const offsets = newIdx.blockSlotIndex.offsets;
      const firstIdx = offsets.findIndex((o) => o !== 0);
      let lastIdx = -1;
      for (let i = offsets.length - 1; i >= 0; i--) {
        if (offsets[i] !== 0) {
          lastIdx = i;
          break;
        }
      }
      if (firstIdx !== -1) {
        const off = offsets[firstIdx];
        const be = readEntry(groupBytes.subarray(off));
        assert.equal(be.type, E2StoreEntryType.CompressedSignedBeaconBlock);
        const slot = newIdx.blockSlotIndex.startSlot + firstIdx;
        const blk = decompressSignedBeaconBlock(be.data, slot, cfg);
        assert.equal(Number(blk.message.slot), slot);
      }
      if (lastIdx !== -1 && lastIdx !== firstIdx) {
        const off2 = offsets[lastIdx];
        const be2 = readEntry(groupBytes.subarray(off2));
        assert.equal(be2.type, E2StoreEntryType.CompressedSignedBeaconBlock);
        const slot2 = newIdx.blockSlotIndex.startSlot + lastIdx;
        const blk2 = decompressSignedBeaconBlock(be2.data, slot2, cfg);
        assert.equal(Number(blk2.message.slot), slot2);
      }

      // For remaining non-empty blocks,  validate TLV type/length without decoding SSZ
      for (let i = 0; i < offsets.length; i++) {
        if (i === firstIdx || i === lastIdx) continue;
        const off = offsets[i];
        if (!off) continue;
        const e = readEntry(groupBytes.subarray(off));
        assert.equal(e.type, E2StoreEntryType.CompressedSignedBeaconBlock);
        assert.ok(e.data.length >= 0);
      }
    }

    // Write the produced ERA file
    console.log("stage: write to disk");
    const outDir = path.resolve(__dirname, "../out");
    if (!existsSync(outDir)) mkdirSync(outDir, {recursive: true});
    const outFile = path.resolve(outDir, `mainnet-${String(expectedEra).padStart(5, "0")}-rewrite.era`);
    writeFileSync(outFile, groupBytes);

    console.log(
      `timings(ms): scan+deserialize=${scanDeserializeMs} serialize=${serializeMs} snappy=${snappyTimeMs} tlvWrite+index=${tlvWriteMs}`
    );
  }, 120000);
});
