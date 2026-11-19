import {createHook} from "node:async_hooks";
import {setTimeout as delay} from "node:timers/promises";
import {expect, test, vi} from "vitest";
import {applicationConfig, localIntent, startRuntime} from "./utils/network.js";
import {BLOCKS, incomingPair, takeIncoming} from "./utils/network-incoming.js";

function samples(text: string): Map<string, number> {
  expect(text.endsWith("\n")).toBe(true);
  const result = new Map<string, number>();
  const families = new Set<string>();
  for (const line of text.trimEnd().split("\n")) {
    if (line.startsWith("# TYPE ")) {
      const name = line.split(" ")[2];
      expect(families.has(name)).toBe(false);
      families.add(name);
    }
    if (line.startsWith("#")) continue;
    const match = /^([a-zA-Z_:][a-zA-Z_0-9:]*(?:\{[^\n]*\})?) (-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)$/.exec(line);
    expect(match, line).not.toBeNull();
    if (!match) throw Error("Malformed metric");
    expect(result.has(match[1]), match[1]).toBe(false);
    result.set(match[1], Number(match[2]));
  }
  return result;
}

test("a scrape racing shutdown during admission rejects with NetworkClosed", async () => {
  const runtime = startRuntime(applicationConfig());
  let closedDuringCreation = false;
  const hook = createHook({
    init(_id, type) {
      if (type !== "PROMISE" || closedDuringCreation) return;
      closedDuringCreation = true;
      runtime.close();
    },
  });
  try {
    hook.enable();
    expect(() => runtime.getMetrics()).toThrow("NetworkClosed");
    hook.disable();
    expect(closedDuringCreation).toBe(true);
  } finally {
    hook.disable();
    await runtime.close();
  }
  expect(() => runtime.getMetrics()).toThrow("NetworkClosed");
});

test("metrics are available while open and reject after close", async () => {
  const config = applicationConfig();
  const runtime = startRuntime(config, () => undefined);
  try {
    expect(samples(await runtime.getMetrics()).get("libp2p_peers")).toBe(0);
    expect(samples(await runtime.getMetrics()).get("lodestar_peer_connection_seconds_count")).toBe(0);
    await runtime.identity;
    await runtime.applyIntent(localIntent(config));
    const metrics = samples(await runtime.getMetrics());
    expect(metrics.get("gossipsub_validation_capacity_count")).toBeGreaterThan(0);
    expect(metrics.get("lodestar_network_step_seconds_count")).toBeGreaterThan(0);
  } finally {
    await runtime.close();
  }
  expect(() => runtime.getMetrics()).toThrow("NetworkClosed");
}, 20000);

test("real request and peer metrics are isolated, cumulative and do not drain requests", async () => {
  const pair = await incomingPair();
  const outgoing = 'beacon_reqresp_outgoing_requests_total{method="beacon_blocks_by_root"}';
  const incoming = 'beacon_reqresp_incoming_requests_total{method="beacon_blocks_by_root"}';
  try {
    const stream = pair.left.request(pair.remote.peerId, BLOCKS, new Uint8Array(32).fill(7));
    const pending = stream.next();
    void pending.catch(() => undefined);
    samples(await pair.right.getMetrics());
    const request = await takeIncoming(pair.right);
    await delay(125);
    await request.finish();
    expect(await pending).toEqual({done: true, value: undefined});
    await vi.waitFor(
      async () => {
        const left = samples(await pair.left.getMetrics());
        const right = samples(await pair.right.getMetrics());
        expect(left.get("libp2p_peers")).toBe(1);
        expect(left.get('lodestar_peer_connected_total{direction="outbound",status="open"}')).toBe(1);
        expect(right.get('lodestar_peer_connected_total{direction="inbound",status="open"}')).toBe(1);
        expect(left.get('lodestar_peers_by_direction_count{direction="outbound"}')).toBe(1);
        expect(right.get('lodestar_peers_by_direction_count{direction="inbound"}')).toBe(1);
        expect(left.get("lodestar_peer_connection_seconds_count")).toBe(1);
        expect(right.get("lodestar_peer_connection_seconds_count")).toBe(1);
        expect(left.get('lodestar_quic_connections_established_total{direction="outbound"}')).toBe(1);
        expect(right.get('lodestar_quic_connections_established_total{direction="inbound"}')).toBe(1);
        expect(left.get('lodestar_peer_dial_outcomes_total{outcome="connected"}')).toBe(1);
        expect(left.get('lodestar_peer_dial_selections_total{source="manual"}')).toBe(1);
        expect(left.get('lodestar_peer_dial_selections_total{source="discovery"}')).toBe(0);
        expect(left.get(outgoing)).toBe(1);
        for (const stage of ["opened", "closed"]) {
          expect(left.get(`beacon_reqresp_outgoing_${stage}_streams_total{method="beacon_blocks_by_root"}`)).toBe(1);
          expect(right.get(`beacon_reqresp_incoming_${stage}_streams_total{method="beacon_blocks_by_root"}`)).toBe(1);
        }
        expect(left.get("beacon_reqresp_dial_errors_total")).toBe(0);
        expect(left.get("lodestar_peer_long_lived_attnets_count_count")).toBe(1);
        expect(left.get("lodestar_peer_column_group_count_count")).toBe(1);
        expect(
          left.get('beacon_reqresp_outgoing_request_roundtrip_time_seconds_count{method="beacon_blocks_by_root"}')
        ).toBe(1);
        expect(
          left.get('beacon_reqresp_outgoing_request_roundtrip_time_seconds_sum{method="beacon_blocks_by_root"}')
        ).toBeGreaterThanOrEqual(0.1);
        expect(
          right.get('beacon_reqresp_incoming_request_handler_time_seconds_count{method="beacon_blocks_by_root"}')
        ).toBe(1);
        expect(left.get("lodestar_quic_udp_sent_bytes_total")).toBeGreaterThan(0);
        expect(right.get("lodestar_quic_udp_received_bytes_total")).toBeGreaterThan(0);
        expect(left.get(incoming)).toBe(0);
        expect(right.get(incoming)).toBe(1);
        expect(right.get(outgoing)).toBe(0);
        expect(right.get('beacon_reqresp_incoming_requests_error_total{method="beacon_blocks_by_root"}')).toBe(0);
      },
      {timeout: 5000}
    );
    for (let i = 0; i < 10; i++) expect(samples(await pair.left.getMetrics()).get(outgoing)).toBe(1);
  } finally {
    await Promise.all([pair.left.stop(), pair.right.close()]);
  }
}, 20000);

test("incoming error responses use the request error metric exactly once", async () => {
  const pair = await incomingPair();
  const incomingErrors = 'beacon_reqresp_incoming_requests_error_total{method="beacon_blocks_by_root"}';
  const outgoingErrors = 'beacon_reqresp_outgoing_requests_error_total{method="beacon_blocks_by_root"}';
  let expected = 0;
  try {
    for (const status of [2, 3]) {
      const stream = pair.left.request(pair.remote.peerId, BLOCKS, new Uint8Array(32));
      const rejected = expect(stream.next()).rejects.toMatchObject({peerStatus: status, reason: "peer_error"});
      const request = await takeIncoming(pair.right);
      await request.fail(status, new TextEncoder().encode("Unavailable"));
      await rejected;
      expected++;
      await vi.waitFor(
        async () => {
          expect(samples(await pair.right.getMetrics()).get(incomingErrors), `response status ${status}`).toBe(
            expected
          );
          expect(samples(await pair.left.getMetrics()).get(outgoingErrors), `response status ${status}`).toBe(expected);
        },
        {timeout: 5000}
      );
    }
  } finally {
    await Promise.all([pair.left.stop(), pair.right.close()]);
  }
}, 20000);
