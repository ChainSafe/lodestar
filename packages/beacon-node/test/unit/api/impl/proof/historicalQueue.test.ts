import {mkdtemp, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";
import {Thread, Worker, spawn} from "@chainsafe/threads";
import {chainConfigToJson} from "@lodestar/config";
import {testLogger} from "@lodestar/logger/test-utils";
import {
  HistoricalStateWorkerApi,
  HistoricalStateWorkerData,
} from "../../../../../src/chain/archiveStore/historicalState/types.js";
import {QueueErrorCode} from "../../../../../src/util/queue/errors.js";
import {proofConfig, proofForkSlot} from "./fixtures.js";

const workerPath = fileURLToPath(
  new URL("../../../../../lib/chain/archiveStore/historicalState/worker.js", import.meta.url)
);

describe.each([false, true])("historical queue transport (native=%s)", (nativeStateTransition) => {
  it("preserves full and aborted queue results across the real worker boundary", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "lodestar-proof-queue-"));
    const workerData: HistoricalStateWorkerData = {
      chainConfigJson: chainConfigToJson(proofConfig),
      genesisValidatorsRoot: new Uint8Array(32),
      genesisTime: 0,
      // Hold one queued request without relying on worker speed or database timing.
      maxConcurrency: 0,
      maxLength: 1,
      dbLocation: path.join(directory, "leveldb"),
      dataColumnDir: path.join(directory, "data_columns"),
      metricsEnabled: false,
      loggerOpts: testLogger().toOpts(),
      nativeStateTransition,
    };
    const rawWorker = new Worker(workerPath, {workerData, suppressResolveScript: true});
    try {
      const worker = await spawn<HistoricalStateWorkerApi>(rawWorker);
      try {
        const pending = Promise.resolve(worker.getHistoricalState(proofForkSlot)).then(
          (value) => ({value}),
          (error: unknown) => ({error})
        );
        await expect(worker.getHistoricalState(proofForkSlot)).resolves.toEqual({
          error: QueueErrorCode.QUEUE_MAX_LENGTH,
        });
        await worker.close();
        await expect(pending).resolves.toEqual({value: {error: QueueErrorCode.QUEUE_ABORTED}});
        await expect(worker.getHistoricalState(proofForkSlot)).resolves.toEqual({
          error: QueueErrorCode.QUEUE_ABORTED,
        });
      } finally {
        await Thread.terminate(worker);
      }
    } finally {
      await rawWorker.terminate();
      await rm(directory, {recursive: true, force: true});
    }
  });
});
