import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {ModuleThread, spawn} from "@chainsafe/threads";
import {createBeaconConfig} from "@lodestar/config";
import {testLogger} from "@lodestar/logger/test-utils";
import {HistoricalStateRegen} from "../../../../../src/chain/archiveStore/historicalState/historicalStateRegen.js";
import {HistoricalStateWorkerApi} from "../../../../../src/chain/archiveStore/historicalState/types.js";
import {QueueError, QueueErrorCode} from "../../../../../src/util/queue/errors.js";
import {proofConfig, proofForkSlot} from "./fixtures.js";

vi.mock("@chainsafe/threads", () => ({
  Worker: vi.fn(class {}),
  spawn: vi.fn(),
  Thread: {terminate: vi.fn()},
}));

describe("historical worker result decoding", () => {
  const logger = testLogger();
  const api = {
    close: vi.fn<HistoricalStateWorkerApi["close"]>().mockResolvedValue(undefined),
    scrapeMetrics: vi.fn<HistoricalStateWorkerApi["scrapeMetrics"]>().mockResolvedValue(""),
    getHistoricalState: vi.fn<HistoricalStateWorkerApi["getHistoricalState"]>(),
  };
  let regen: HistoricalStateRegen;

  beforeEach(async () => {
    api.getHistoricalState.mockReset();
    vi.mocked(spawn<HistoricalStateWorkerApi>).mockResolvedValue(
      api as unknown as ModuleThread<HistoricalStateWorkerApi>
    );
    regen = await HistoricalStateRegen.init({
      opts: {genesisTime: 0, dbLocation: "unused", dataColumnDir: "unused", nativeStateTransition: false},
      config: createBeaconConfig(proofConfig, new Uint8Array(32)),
      logger,
      metrics: null,
    });
  });

  afterEach(async () => {
    await regen.close();
  });

  it.each([QueueErrorCode.QUEUE_MAX_LENGTH, QueueErrorCode.QUEUE_ABORTED])(
    "restores the typed %s error after worker transfer",
    async (code) => {
      api.getHistoricalState.mockResolvedValueOnce({error: code});
      const error = await regen.getHistoricalState(proofForkSlot).catch((error: unknown) => error);
      expect(error).toBeInstanceOf(QueueError);
      expect(error).toMatchObject({type: {code}});
      expect(api.getHistoricalState).toHaveBeenLastCalledWith(proofForkSlot);

      const bytes = Uint8Array.of(1, 2, 3);
      api.getHistoricalState.mockResolvedValueOnce(bytes);
      await expect(regen.getHistoricalState(proofForkSlot)).resolves.toBe(bytes);
    }
  );

  it("preserves unavailable results", async () => {
    api.getHistoricalState.mockResolvedValueOnce(null);
    await expect(regen.getHistoricalState(proofForkSlot)).resolves.toBeNull();
  });

  it.each(["Database failed", QueueErrorCode.QUEUE_MAX_LENGTH])(
    "preserves an unexpected rejection with message %s",
    async (message) => {
      const failure = new Error(message);
      api.getHistoricalState.mockRejectedValueOnce(failure);
      await expect(regen.getHistoricalState(proofForkSlot)).rejects.toBe(failure);
    }
  );
});
