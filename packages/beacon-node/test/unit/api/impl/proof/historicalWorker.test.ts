import {mkdtemp, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {LevelDbController} from "@lodestar/db/controller/level";
import {testLogger} from "@lodestar/logger/test-utils";
import {HistoricalStateRegen} from "../../../../../src/chain/archiveStore/historicalState/historicalStateRegen.js";
import {BeaconDb} from "../../../../../src/db/index.js";
import {proofConfig, proofForkSlot} from "./fixtures.js";
import {createTransitionChain} from "./transitionFixtures.js";

const backends = process.env.LODESTAR_NATIVE_STATE_TRANSITION === "true" ? [false, true] : [false];

describe.each(backends)("historical proof worker transport (native=%s)", (nativeStateTransition) => {
  let directory: string;
  let worker: HistoricalStateRegen;
  let chain: ReturnType<typeof createTransitionChain>;

  beforeAll(async () => {
    chain = createTransitionChain(false);
    directory = await mkdtemp(path.join(os.tmpdir(), "lodestar-proof-worker-"));
    const dbLocation = path.join(directory, "leveldb");
    const dataColumnDir = path.join(directory, "data_columns");
    const logger = testLogger();
    const db = new BeaconDb(proofConfig, await LevelDbController.create({name: dbLocation}, {logger}), {
      dataColumnDir,
      logger,
    });
    try {
      await db.stateArchive.put(chain.anchor.slot, chain.anchor);
      for (const slot of [proofForkSlot - 1, proofForkSlot]) await db.blockArchive.add(chain.blockAt(slot));
      await db.stateArchive.putBinary(proofForkSlot + 2, Uint8Array.of(0));
    } finally {
      await db.close();
    }
    worker = await HistoricalStateRegen.init({
      opts: {genesisTime: 0, dbLocation, dataColumnDir, nativeStateTransition},
      config: createBeaconConfig(proofConfig, chain.anchor.genesisValidatorsRoot),
      logger,
      metrics: null,
    });
  });

  afterAll(async () => {
    await worker?.close();
    chain?.close();
    if (directory) await rm(directory, {recursive: true, force: true});
  });

  it("returns null across the worker boundary when no seed state is retained", async () => {
    await expect(worker.getHistoricalState(chain.anchor.slot - 1)).resolves.toBeNull();
  });

  it.each([proofForkSlot - 1, proofForkSlot])("transfers reconstructed bytes for slot %i", async (slot) => {
    const bytes = await worker.getHistoricalState(slot);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes).toEqual(chain.stateAt(slot).serialize());
  });

  it("returns null when replay cannot reach the requested slot", async () => {
    await expect(worker.getHistoricalState(proofForkSlot + 1)).resolves.toBeNull();
  });

  it("rejects corrupt state bytes and continues serving subsequent requests", async () => {
    await expect(worker.getHistoricalState(proofForkSlot + 2)).rejects.toThrow();
    await expect(worker.getHistoricalState(chain.anchor.slot - 1)).resolves.toBeNull();
    expect(await worker.getHistoricalState(proofForkSlot)).toEqual(chain.stateAt(proofForkSlot).serialize());
  });
});
