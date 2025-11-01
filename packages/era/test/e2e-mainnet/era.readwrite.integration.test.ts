import {existsSync, mkdirSync} from "node:fs";
import path, {basename} from "node:path";
import {fileURLToPath} from "node:url";
import {beforeAll, describe, expect, it} from "vitest";
import {ChainForkConfig, createChainForkConfig} from "@lodestar/config";
import {mainnetChainConfig} from "@lodestar/config/networks";
import {SLOTS_PER_HISTORICAL_ROOT} from "@lodestar/params";
import {EraReader, EraWriter} from "../../src/era/index.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe.runIf(!process.env.CI)("read original era and re-write our own era file", () => {
  let config: ChainForkConfig;
  const eraPath = path.resolve(__dirname, "../mainnet-01506-4781865b.era");
  const expectedEra = 1506;

  beforeAll(() => {
    config = createChainForkConfig(mainnetChainConfig);
  });

  it("validate an existing era file, rewrite into a new era file, and validate that new era file", async () => {
    const SPR = SLOTS_PER_HISTORICAL_ROOT;
    const stateSlot = expectedEra * SPR;

    const startTime = Date.now();
    let t0 = startTime;

    console.log("stage: open and read original era file");
    const reader = await EraReader.open(config, eraPath);
    console.log(`  time: ${Date.now() - t0}ms`);
    t0 = Date.now();

    console.log(`progress: ${reader.groups.length} group(s) found`);

    console.log("stage: validate original era file");
    await reader.validate();
    console.log(`  time: ${Date.now() - t0}ms`);
    t0 = Date.now();

    console.log("stage: create new era file writer");
    const outDir = path.resolve(__dirname, "../out");
    if (!existsSync(outDir)) mkdirSync(outDir, {recursive: true});
    let outFile = path.resolve(outDir, `mainnet-${String(expectedEra).padStart(5, "0")}-deadbeef.era`);

    const writer = await EraWriter.create(config, outFile, expectedEra);
    console.log(`  time: ${Date.now() - t0}ms`);
    t0 = Date.now();

    console.log("stage: read blocks from original and write to new era file");
    const blocksIndex = reader.groups[0].blocksIndex;
    if (!blocksIndex) {
      throw new Error("Original era file missing blocks index");
    }
    for (let slot = blocksIndex.startSlot; slot < blocksIndex.startSlot + blocksIndex.offsets.length; slot++) {
      const block = await reader.readBlock(slot);
      if (block === null) continue;
      await writer.writeBlock(block);
    }
    console.log(`  time: ${Date.now() - t0}ms`);
    t0 = Date.now();

    console.log("stage: read state from original era file");
    const originalState = await reader.readState();
    expect(originalState.slot).to.equal(stateSlot);
    console.log(`  time: ${Date.now() - t0}ms`);
    t0 = Date.now();

    console.log("stage: write state to new era file");
    await writer.writeState(originalState);
    console.log(`  time: ${Date.now() - t0}ms`);
    t0 = Date.now();

    console.log("stage: finish reading and writing");
    await reader.close();
    outFile = await writer.finish();
    console.log(`  time: ${Date.now() - t0}ms`);
    t0 = Date.now();

    expect(basename(outFile)).to.equal(basename(eraPath));

    console.log("stage: open and validate new era file");
    const newReader = await EraReader.open(config, outFile);
    await newReader.validate();
    console.log(`  time: ${Date.now() - t0}ms`);
    t0 = Date.now();

    // Cleanup
    await newReader.close();

    const totalTime = Date.now() - startTime;
    console.log("Round-trip test passed");
    console.log(`  Total time: ${totalTime}ms (${(totalTime / 1000).toFixed(2)}s)`);
  }, 1000000);
});
