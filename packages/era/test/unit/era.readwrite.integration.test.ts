import {existsSync, mkdirSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {assert, beforeAll, describe, it} from "vitest";
import {ChainForkConfig, createChainForkConfig} from "@lodestar/config";
import {config as defaultConfig} from "@lodestar/config/default";
import {SLOTS_PER_HISTORICAL_ROOT} from "@lodestar/params";
import {EraFileReader, EraFileWriter, createEraFile, openEraFile} from "../../src/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe.runIf(!process.env.CI)("read original era and re-write our own era file", () => {
  let cfg: ChainForkConfig;
  const eraPath = path.resolve(__dirname, "../mainnet-01506-4781865b.era");
  const expectedEra = 1506;

  beforeAll(() => {
    cfg = createChainForkConfig(defaultConfig);
  });

  it("reads an existing era file and writes a new era file that round-trips", async () => {
    const SPR = SLOTS_PER_HISTORICAL_ROOT;
    const stateSlot = expectedEra * SPR;
    const blockStartSlot = stateSlot - SPR;

    const startTime = Date.now();
    let t0 = startTime;

    console.log("stage: open and read original era file");
    const originalEraFile = await openEraFile(eraPath);
    const originalIndex = await originalEraFile.createIndex();
    const reader = new EraFileReader(originalEraFile, originalIndex, cfg);
    console.log(`  time: ${Date.now() - t0}ms`);
    t0 = Date.now();

    console.log("stage: read state from original file");
    const originalState = await reader.readCanonicalState();
    assert.equal(Number(originalState.slot), stateSlot);
    console.log(`  time: ${Date.now() - t0}ms`);
    t0 = Date.now();

    console.log("stage: read blocks from original file");
    const blocks: {slot: number; block: any}[] = [];
    for (let i = 0; i < originalIndex.indices.length; i++) {
      if (originalIndex.indices[i] === 0) continue;
      const slot = blockStartSlot + i;
      const block = await reader.readBlock(slot);
      assert.ok(block !== null, `Expected block at slot ${slot} but got null`);
      blocks.push({slot, block});
      if ((i & 0x1ff) === 0) {
        console.log(`progress: scanned ${i}/${SPR} slots, non-empty ${blocks.length}`);
      }
    }
    console.log(`stage: read complete (non-empty blocks=${blocks.length})`);
    console.log(`  time: ${Date.now() - t0}ms`);
    t0 = Date.now();

    await originalEraFile.close();

    console.log("stage: create and write new era file");
    console.log("stage: create and write new era file");
    const outDir = path.resolve(__dirname, "../out");
    if (!existsSync(outDir)) mkdirSync(outDir, {recursive: true});
    const outFile = path.resolve(outDir, `mainnet-${String(expectedEra).padStart(5, "0")}-rewrite.era`);

    const newEraFile = await createEraFile(outFile, expectedEra);
    const writer = new EraFileWriter(newEraFile, cfg);

    // Write state
    console.log("stage: write state");
    await writer.writeCanonicalState(originalState);
    console.log(`  time: ${Date.now() - t0}ms`);
    t0 = Date.now();

    // Write all blocks
    console.log("stage: write blocks");
    for (const {block} of blocks) {
      await writer.writeBlock(block);
    }
    console.log(`  time: ${Date.now() - t0}ms`);
    t0 = Date.now();

    // Finish writing
    console.log("stage: finish writing");
    await writer.finish();
    await newEraFile.close();
    console.log(`  time: ${Date.now() - t0}ms`);
    t0 = Date.now();

    console.log("stage: validate new era file");
    // Open and validate the new file
    const validationEraFile = await openEraFile(outFile);
    const validationIndex = await validationEraFile.createIndex();
    const validationReader = new EraFileReader(validationEraFile, validationIndex, cfg);
    console.log(`  time: ${Date.now() - t0}ms`);
    t0 = Date.now();

    // Validate entire era file format and correctness
    console.log("stage: validate era file format");
    await validationEraFile.validate(cfg);
    console.log(`  time: ${Date.now() - t0}ms`);
    t0 = Date.now();

    // Validate index matches
    assert.equal(validationIndex.startSlot, blockStartSlot);
    assert.equal(validationIndex.indices.length, SPR);
    const newNonEmpty = validationIndex.indices.filter((o) => o !== 0).length;
    assert.equal(newNonEmpty, blocks.length);

    // Validate empty/non-empty slot pattern matches original
    for (let i = 0; i < SPR; i++) {
      const originalIsEmpty = originalIndex.indices[i] === 0;
      const newIsEmpty = validationIndex.indices[i] === 0;
      assert.equal(newIsEmpty, originalIsEmpty, `Slot ${blockStartSlot + i} empty/non-empty status should match`);
    }

    // Validate state matches (full comparison via SSZ serialization)
    console.log("stage: validate state");
    const validatedState = await validationReader.readCanonicalState();

    // Serialize both states and compare bytes - this proves they're 100% identical
    const originalTypes = cfg.getForkTypes(originalState.slot);
    const validatedTypes = cfg.getForkTypes(validatedState.slot);
    const originalSSZ = originalTypes.BeaconState.serialize(originalState);
    const validatedSSZ = validatedTypes.BeaconState.serialize(validatedState);

    assert.deepEqual(validatedSSZ, originalSSZ, "State SSZ bytes should match exactly");
    console.log(`  time: ${Date.now() - t0}ms`);
    t0 = Date.now();

    // Validate ALL blocks match exactly (full comparison via SSZ serialization)
    console.log("stage: validate all blocks");
    for (const {slot, block} of blocks) {
      const validatedBlock = await validationReader.readBlock(slot);
      assert.ok(validatedBlock !== null, `Block at slot ${slot} should not be null`);

      // Serialize both blocks and compare bytes - this proves they're 100% identical
      const types = cfg.getForkTypes(slot);
      const originalSSZ = types.SignedBeaconBlock.serialize(block);
      const validatedSSZ = types.SignedBeaconBlock.serialize(validatedBlock);
      assert.deepEqual(validatedSSZ, originalSSZ, `Block at slot ${slot} SSZ bytes should match exactly`);
    }
    console.log(`  time: ${Date.now() - t0}ms`);
    t0 = Date.now();

    // Validate empty slots remain empty
    console.log("stage: validate empty slots");
    for (let i = 0; i < originalIndex.indices.length; i++) {
      if (originalIndex.indices[i] === 0) {
        const slot = blockStartSlot + i;
        const validatedBlock = await validationReader.readBlock(slot);
        assert.equal(validatedBlock, null, `Slot ${slot} should be empty`);
      }
    }
    console.log(`  time: ${Date.now() - t0}ms`);

    // Cleanup
    await validationEraFile.close();

    const totalTime = Date.now() - startTime;
    console.log(`Round-trip test passed: ${blocks.length} blocks written and fully validated`);
    console.log(`  Total time: ${totalTime}ms (${(totalTime / 1000).toFixed(2)}s)`);
  }, 120000);
});
