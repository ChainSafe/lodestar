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

    const reader = await EraReader.open(config, eraPath);

    await reader.validate();
    const outDir = path.resolve(__dirname, "../out");
    if (!existsSync(outDir)) mkdirSync(outDir, {recursive: true});
    let outFile = path.resolve(outDir, `mainnet-${String(expectedEra).padStart(5, "0")}-deadbeef.era`);

    const writer = await EraWriter.create(config, outFile, expectedEra);
    const blocksIndex = reader.groups[0].blocksIndex;
    if (!blocksIndex) {
      throw new Error("Original era file missing blocks index");
    }
    for (let slot = blocksIndex.startSlot; slot < blocksIndex.startSlot + blocksIndex.offsets.length; slot++) {
      const block = await reader.readBlock(slot);
      if (block === null) continue;
      await writer.writeBlock(block);
    }
    const originalState = await reader.readState();
    expect(originalState.slot).to.equal(stateSlot);
    await writer.writeState(originalState);
    await reader.close();
    outFile = await writer.finish();

    expect(basename(outFile)).to.equal(basename(eraPath));
    const newReader = await EraReader.open(config, outFile);
    await newReader.validate();

    await newReader.close();
  }, 1000000);
});
