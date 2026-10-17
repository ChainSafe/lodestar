import {Gauge, Registry, collectDefaultMetrics} from "prom-client";
import {afterEach, describe, expect, it, vi} from "vitest";
import {testLogger} from "@lodestar/logger/test-utils";
import {fetch} from "@lodestar/utils";
import {
  HttpMetricsServer,
  createBeaconEngineMetrics,
  createMetrics,
  getHttpMetricsServer,
} from "../../../../src/metrics/index.js";

describe("HttpMetricsServer", () => {
  const logger = testLogger();

  let server: HttpMetricsServer | null = null;
  let closeMetrics: (() => void) | undefined;
  const port = 14500;

  it("should serve metrics on /metrics", async () => {
    const metrics = createMetrics({enabled: true, port}, 0, [], {collectNodeMetrics: false});
    closeMetrics = metrics.close;
    const engine = createBeaconEngineMetrics();
    const networkRegister = new Registry();
    new Gauge({name: "network_test", help: "Network metrics", registers: [networkRegister]}).set(7);
    const nestedRegister = new Registry();
    new Gauge({name: "historical_test", help: "Historical metrics", registers: [nestedRegister]}).set(11);
    const scrapeEngine = vi.fn(async () => ({
      metrics: structuredClone(await engine.register.getMetricsAsJSON()),
      extra: await nestedRegister.metrics(),
    }));
    metrics.bls.aggregatedPubkeys.inc(2);
    engine.bls.aggregatedPubkeys.inc(3);
    server = await getHttpMetricsServer(
      {port, address: "127.0.0.1"},
      {
        register: metrics.register,
        getOtherMetrics: () => Promise.all([networkRegister.metrics(), scrapeEngine()]),
        logger,
      }
    );

    const res = await fetch(`http://127.0.0.1:${port}/metrics`, {headers: {connection: "close"}});
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("beacon_head_slot 0\n");
    expect(text).toContain("beacon_pending_deposits 0\n");
    expect(text).toContain("lodestar_bls_aggregated_pubkeys_total 5\n");
    expect(text).toContain("network_test 7\n");
    expect(text).toContain("historical_test 11\n");
    expect(scrapeEngine).toHaveBeenCalledOnce();
    const declarations = text.split("\n").filter((line) => /^# (HELP|TYPE) /.test(line));
    expect(new Set(declarations).size).toBe(declarations.length);
    const samples = text
      .split("\n")
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => line.slice(0, line.lastIndexOf(" ")));
    expect(new Set(samples).size).toBe(samples.length);
    const second = await fetch(`http://127.0.0.1:${port}/metrics`, {headers: {connection: "close"}});
    expect(await second.text()).toContain("lodestar_bls_aggregated_pubkeys_total 5\n");
    expect(scrapeEngine).toHaveBeenCalledTimes(2);
  });

  it("preserves process metrics and default labels without an engine", async () => {
    const register = new Registry();
    collectDefaultMetrics({register});
    register.setDefaultLabels({network: "test"});
    server = await getHttpMetricsServer({port, address: "127.0.0.1"}, {register, logger});
    const res = await fetch(`http://127.0.0.1:${port}/metrics`, {headers: {connection: "close"}});
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toMatch(/process_start_time_seconds\{network="test"\} \d/);
    expect(text).toMatch(/process_cpu_user_seconds_total\{network="test"\} \d/);
  });

  it("returns HTTP 500 when an additional scrape fails", async () => {
    const metrics = createMetrics({enabled: true, port}, 0, [], {collectNodeMetrics: false});
    closeMetrics = metrics.close;
    server = await getHttpMetricsServer(
      {port, address: "127.0.0.1"},
      {
        register: metrics.register,
        getOtherMetrics: async () => {
          throw Error("engine scrape failed");
        },
        logger,
      }
    );
    const res = await fetch(`http://127.0.0.1:${port}/metrics`, {headers: {connection: "close"}});
    expect(res.status).toBe(500);
    expect(await res.text()).toContain("engine scrape failed");
  });

  afterEach(async () => {
    if (server) await server.close();
    server = null;
    closeMetrics?.();
  });
});
