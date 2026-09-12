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

  it.each(["constructor", "setMetrics"])("should collect indexed slot counts with %s metrics", async (source) => {
    const dataColumnDir = path.join(tmpDir, "data_columns");
    await fs.promises.mkdir(path.join(dataColumnDir, "000000000100"), {recursive: true});
    await fs.promises.mkdir(path.join(dataColumnDir, "000000000200"));
    const metrics = createMetricsTest();
    const store = new FlatFileStore(
      dataColumnDir,
      config,
      logger,
      source === "constructor" ? metrics.flatFileStore : null
    );
    await store.init();
    if (source === "setMetrics") store.setMetrics(metrics.flatFileStore);

    const name = "lodestar_flat_file_store_indexed_slots";
    expect(metrics.register.getSingleMetric(name)).toBeDefined();
    const readDirectories = vi.spyOn(fs.promises, "readdir");
    try {
      await expect(metrics.register.getSingleMetricAsString(name)).resolves.toContain(`${name} 2`);
      expect(readDirectories).not.toHaveBeenCalled();
    } finally {
      readDirectories.mockRestore();
    }

    await store.putDataColumnsBinary(150, ROOT, [{index: 0, data: new Uint8Array(50)}]);
    await expect(metrics.register.getSingleMetricAsString(name)).resolves.toContain(`${name} 3`);
    await store.deleteMany([{slot: 150, blockRoot: ROOT}]);
    await expect(metrics.register.getSingleMetricAsString(name)).resolves.toContain(`${name} 3`);
    await store.pruneBefore(200);
    await expect(metrics.register.getSingleMetricAsString(name)).resolves.toContain(`${name} 1`);
  });

  it("should collect into the registry being scraped after metrics replacement", async () => {
    const firstMetrics = createMetricsTest();
    const secondMetrics = createMetricsTest();
    const store = new FlatFileStore(path.join(tmpDir, "data_columns"), config, logger, firstMetrics.flatFileStore);
    await store.init();
    store.setMetrics(secondMetrics.flatFileStore);
    await store.putDataColumnsBinary(100, ROOT, [{index: 0, data: new Uint8Array(50)}]);

    const name = "lodestar_flat_file_store_indexed_slots";
    for (const [index, metrics] of [firstMetrics, secondMetrics].entries()) {
      expect(metrics.register.getSingleMetric(name), `registry ${index}`).toBeDefined();
      await expect(metrics.register.getSingleMetricAsString(name), `registry ${index}`).resolves.toContain(`${name} 1`);
    }
  });

  it("should record filesystem operations, bytes, pruning, and failures", async () => {
    const metrics = createMetricsTest();
    const store = new FlatFileStore(path.join(tmpDir, "data_columns"), config, logger, metrics.flatFileStore);
    await store.init();

    await store.putDataColumnsBinary(100, ROOT, [{index: 0, data: new Uint8Array(50).fill(0xaa)}]);
    await store.getDataColumnsBinary(100, ROOT, [0]);

    const readError = Object.assign(new Error("read failed"), {code: "EIO"});
    const readSpy = vi.spyOn(fs.promises, "open").mockRejectedValueOnce(readError);
    try {
      await expect(store.getDataColumnsBinary(100, ROOT, [0])).rejects.toMatchObject({cause: readError});
    } finally {
      readSpy.mockRestore();
    }

    await store.deleteMany([{slot: 100, blockRoot: ROOT}]);
    await store.pruneBefore(200);

    await expect(
      metrics.register.getSingleMetricAsString("lodestar_flat_file_store_write_bytes_total")
    ).resolves.toContain("lodestar_flat_file_store_write_bytes_total ");
    await expect(
      metrics.register.getSingleMetricAsString("lodestar_flat_file_store_read_bytes_total")
    ).resolves.toContain("lodestar_flat_file_store_read_bytes_total ");
    await expect(
      metrics.register.getSingleMetricAsString("lodestar_flat_file_store_pruned_directories_total")
    ).resolves.toContain("lodestar_flat_file_store_pruned_directories_total 1");
    await expect(
      metrics.register.getSingleMetricAsString("lodestar_flat_file_store_operation_errors_total")
    ).resolves.toContain('lodestar_flat_file_store_operation_errors_total{operation="read"} 1');
    const exportedMetrics = await metrics.register.getMetricsAsJSON();
    for (const [operation, count] of Object.entries({read: 2, write: 1, delete: 1, prune: 1})) {
      const name = `lodestar_flat_file_store_${operation}_duration_seconds`;
      const histogram = exportedMetrics.find((metric) => metric.name === name);
      expect(histogram, `${operation} duration histogram`).toBeDefined();
      expect(histogram?.values, `${operation} duration series count`).toHaveLength(9);
      expect(histogram?.values, `${operation} observation count`).toContainEqual({
        metricName: `${name}_count`,
        labels: {},
        value: count,
      });
    }
    expect(metrics.register.getSingleMetric("lodestar_flat_file_store_operation_duration_seconds")).toBeUndefined();
    await expect(
      metrics.register.getSingleMetricAsString("lodestar_flat_file_store_startup_duration_seconds")
    ).resolves.toContain("lodestar_flat_file_store_startup_duration_seconds_count 1");

    const startupError = Object.assign(new Error("startup failed"), {code: "EIO"});
    const readdirSpy = vi.spyOn(fs.promises, "readdir").mockRejectedValueOnce(startupError);
    try {
      const failedStore = new FlatFileStore(path.join(tmpDir, "data_columns"), config, logger, metrics.flatFileStore);
      await expect(failedStore.init()).rejects.toMatchObject({cause: startupError});
    } finally {
      readdirSpy.mockRestore();
    }
    await expect(
      metrics.register.getSingleMetricAsString("lodestar_flat_file_store_startup_errors_total")
    ).resolves.toContain("lodestar_flat_file_store_startup_errors_total 1");
  });
});
