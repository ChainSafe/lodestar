import {afterEach, describe, expect, it} from "vitest";
import {aggregateMetrics, createBeaconEngineMetrics, createMetrics} from "../../../src/metrics/index.js";

describe("BeaconEngine metrics registries", () => {
  const close: (() => void)[] = [];
  afterEach(() => {
    for (const fn of close.splice(0)) fn();
  });

  function createNode() {
    const metrics = createMetrics({enabled: true, port: 0}, 1, [], {collectNodeMetrics: false});
    close.push(metrics.close);
    return metrics;
  }

  it.each([false, true])("exports both registries once with nativeStateTransition=%s", async (native) => {
    const node = createNode();
    const engine = createBeaconEngineMetrics(native);
    const combined = await aggregateMetrics([
      await engine.register.getMetricsAsJSON(),
      await node.register.getMetricsAsJSON(),
    ]);
    const schema = (text: string): string[] =>
      text
        .split("\n")
        .filter((line) => /^# (HELP|TYPE) /.test(line))
        .sort();
    const actual = schema(combined);
    const expected = new Set(schema([await node.register.metrics(), await engine.register.metrics()].join("\n")));
    expect(actual).toEqual([...expected].sort());
    expect(new Set(actual).size).toBe(actual.length);
    expect(engine.stateTransition === null).toBe(native);
    expect(engine.register.getSingleMetric("beacon_head_slot")).toBeUndefined();
    expect(node.register.getSingleMetric("beacon_pending_deposits")).toBeUndefined();
    expect(engine.register.getSingleMetric("lodestar_api_rest_response_time_seconds")).toBeUndefined();
  });

  it("aggregates shared observations without sharing handles or accumulating repeated scrapes", async () => {
    const node = createNode();
    const engine = createBeaconEngineMetrics();
    expect(node.bls.aggregatedPubkeys).not.toBe(engine.bls.aggregatedPubkeys);
    node.bls.aggregatedPubkeys.inc(3);
    engine.bls.aggregatedPubkeys.inc(5);
    node.blsThreadPool.mainThreadDurationInThreadPool.observe(0.01);
    engine.blsThreadPool.mainThreadDurationInThreadPool.observe(0.02);
    engine.blockSerializedCache.size.set({owner: "engine"}, 4);
    node.precomputeNextEpochTransition.count.inc({result: "error"});
    engine.precomputeNextEpochTransition.count.inc({result: "success"});
    node.builderApi.preferencesForwarded.inc({status: "success"});
    engine.builderApi.preferencesForwarded.inc({status: "success"}, 2);
    node.db.dbReadReq.inc({bucket: "allForks_block"}, 3);
    engine.db.dbReadReq.inc({bucket: "allForks_block"}, 5);
    node.db.dbSizeTotal.set(100);
    expect(engine.register.getSingleMetric("lodestar_db_size_bytes_total")).toBeUndefined();
    expect(engine.register.getSingleMetric("lodestar_db_approximate_size_time_seconds")).toBeUndefined();

    const collect = async (): Promise<string> =>
      aggregateMetrics([
        structuredClone(await engine.register.getMetricsAsJSON()),
        await node.register.getMetricsAsJSON(),
      ]);
    const text = await collect();
    expect(text).toContain("lodestar_bls_aggregated_pubkeys_total 8\n");
    expect(text).toContain("lodestar_bls_thread_pool_main_thread_time_seconds_count 2\n");
    expect(text).toContain("lodestar_bls_thread_pool_main_thread_time_seconds_sum 0.03\n");
    expect(text).toContain('lodestar_block_cache_entries{owner="engine"} 4\n');
    expect(text).toContain('lodestar_precompute_next_epoch_transition_result_total{result="error"} 1\n');
    expect(text).toContain('lodestar_precompute_next_epoch_transition_result_total{result="success"} 1\n');
    expect(text).toContain('lodestar_builder_api_preferences_forwarded_total{status="success"} 3\n');
    expect(text).toContain('lodestar_db_read_req_total{bucket="allForks_block"} 8\n');
    expect(text).toContain("lodestar_db_size_bytes_total 100\n");
    expect(await collect()).toBe(text);
    expect(await node.register.metrics()).toContain("lodestar_bls_aggregated_pubkeys_total 3\n");
    expect(await engine.register.metrics()).toContain("lodestar_bls_aggregated_pubkeys_total 5\n");
  });

  it("preserves builder-client collect precedence instead of adding URL scores", async () => {
    const node = createNode();
    const engine = createBeaconEngineMetrics();
    const labels = {urlIndex: 0, baseUrl: "http://builder:18550"};
    node.builderHttpClient.urlsScore.set(labels, 90);
    node.builderHttpClient.urlsScore.set({...labels, baseUrl: "http://fallback:18550"}, 80);
    engine.builderHttpClient.urlsScore.set(labels, 70);
    const text = await aggregateMetrics([
      await engine.register.getMetricsAsJSON(),
      await node.register.getMetricsAsJSON(),
    ]);
    expect(text).toContain('lodestar_builder_http_client_urls_score{urlIndex="0",baseUrl="http://builder:18550"} 70\n');
    expect(text).toContain(
      'lodestar_builder_http_client_urls_score{urlIndex="0",baseUrl="http://fallback:18550"} 80\n'
    );
  });

  it("creates engine metrics without process collectors", () => {
    const listenerCount = process.listenerCount("unhandledRejection");
    const engine = createBeaconEngineMetrics();
    expect(process.listenerCount("unhandledRejection")).toBe(listenerCount);
    expect(engine.register.getSingleMetric("process_cpu_user_seconds_total")).toBeUndefined();
    expect(engine.register.getSingleMetric("lodestar_unhandled_promise_rejections_total")).toBeUndefined();
  });
});
