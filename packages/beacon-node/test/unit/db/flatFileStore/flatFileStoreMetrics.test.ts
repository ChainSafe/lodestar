import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {config as defaultConfig} from "@lodestar/config/default";
import {testLogger} from "@lodestar/logger/test-utils";
import {FlatFileStore} from "../../../../src/db/flatFileStore/flatFileStore.js";
import {createMetricsTest} from "../../metrics/utils.js";

const ROOT = "0x" + "aa".repeat(32);
const config = createChainForkConfig({...defaultConfig, FULU_FORK_EPOCH: 0});
const logger = testLogger("flat-file-metrics");

describe("FlatFileStore metrics", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "lodestar-flatfile-metrics-"));
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, {recursive: true, force: true});
  });

  it("should record filesystem operations, bytes, files, pruning, and failures", async () => {
    const metrics = createMetricsTest();
    const store = new FlatFileStore(tmpDir, config, logger, metrics.flatFileStore);
    await store.init(Number.MAX_SAFE_INTEGER);

    const blobData = new Uint8Array([1, 2, 3, 4]);
    await store.putBlobSidecarsBinary(100, ROOT, blobData);
    await store.getBlobSidecarsBinary(100, ROOT);

    await store.putDataColumnsBinary(100, ROOT, [{index: 0, data: new Uint8Array(50).fill(0xaa)}]);
    await store.getDataColumnsBinary(100, ROOT, [0]);

    const readError = Object.assign(new Error("read failed"), {code: "EIO"});
    const readSpy = vi.spyOn(fs.promises, "readFile").mockRejectedValueOnce(readError);
    try {
      await expect(store.getBlobSidecarsBinary(100, ROOT)).rejects.toBe(readError);
    } finally {
      readSpy.mockRestore();
    }

    await store.pruneBlobsBeforeSlot(200);
    await store.pruneColumnsBeforeSlot(200);

    await expect(
      metrics.register.getSingleMetricAsString("lodestar_flat_file_store_write_bytes_total")
    ).resolves.toContain('lodestar_flat_file_store_write_bytes_total{store="blob"} 4');
    await expect(
      metrics.register.getSingleMetricAsString("lodestar_flat_file_store_read_bytes_total")
    ).resolves.toContain('lodestar_flat_file_store_read_bytes_total{store="blob"} 4');
    await expect(metrics.register.getSingleMetricAsString("lodestar_flat_file_store_files")).resolves.toContain(
      'lodestar_flat_file_store_files{store="blob"} 0'
    );
    await expect(
      metrics.register.getSingleMetricAsString("lodestar_flat_file_store_pruned_directories_total")
    ).resolves.toContain('lodestar_flat_file_store_pruned_directories_total{store="column"} 1');
    await expect(
      metrics.register.getSingleMetricAsString("lodestar_flat_file_store_operation_errors_total")
    ).resolves.toContain('lodestar_flat_file_store_operation_errors_total{store="blob",operation="read"} 1');
    await expect(
      metrics.register.getSingleMetricAsString("lodestar_flat_file_store_operation_duration_seconds")
    ).resolves.toContain(
      'lodestar_flat_file_store_operation_duration_seconds_count{store="column",operation="write"} 1'
    );
    await expect(
      metrics.register.getSingleMetricAsString("lodestar_flat_file_store_startup_duration_seconds")
    ).resolves.toContain("lodestar_flat_file_store_startup_duration_seconds_count 1");

    const startupError = Object.assign(new Error("startup failed"), {code: "EIO"});
    const mkdirSpy = vi.spyOn(fs.promises, "mkdir").mockRejectedValueOnce(startupError);
    try {
      const failedStore = new FlatFileStore(tmpDir, config, logger, metrics.flatFileStore);
      await expect(failedStore.init(Number.MAX_SAFE_INTEGER)).rejects.toBe(startupError);
    } finally {
      mkdirSpy.mockRestore();
    }
    await expect(
      metrics.register.getSingleMetricAsString("lodestar_flat_file_store_startup_errors_total")
    ).resolves.toContain("lodestar_flat_file_store_startup_errors_total 1");
  });
});
