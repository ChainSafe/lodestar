// Canned series for `check-grafana-dashboard-queries.mjs`.
//
// Each fixture names one dashboard query. Each case maps series to promtool's expanding notation, sampled every
// minute for 40 minutes, and lists the samples the query returns at 40m. An empty `expect` means no result: a missing
// producer must stay missing rather than read as zero.

const native = 'instance="native",job="beacon"';
const libp2p = 'instance="libp2p",job="beacon"';
const libp2pOther = 'instance="libp2p-2",job="beacon"';

/** A counter growing by `n` per second */
function perSecond(n) {
  return `0+${60 * n}x40`;
}

/** A gauge holding `n` */
function constant(n) {
  return `${n}x40`;
}

/** Requests of a method over 5 s per minute, from a histogram with buckets 5 and 10 */
function slowRequests(name, dashboard, panel) {
  return {
    dashboard,
    panel,
    refId: "A",
    cases: [
      {
        name: "each target's method against its own count, with either le spelling",
        series: {
          [`${name}_count{${libp2p},method="status"}`]: perSecond(2),
          [`${name}_bucket{${libp2p},method="status",le="5"}`]: perSecond(1),
          [`${name}_bucket{${libp2p},method="status",le="10"}`]: perSecond(2),
          [`${name}_count{${native},method="status"}`]: perSecond(2),
          [`${name}_bucket{${native},method="status",le="5.0"}`]: perSecond(2),
          [`${name}_bucket{${native},method="status",le="10.0"}`]: perSecond(2),
        },
        expect: [
          {labels: `{${libp2p},method="status"}`, value: 60},
          {labels: `{${native},method="status"}`, value: 0},
        ],
      },
      {
        name: "a target without the histogram has no result, not a zero",
        series: {[`beacon_reqresp_outgoing_requests_total{${native},method="status"}`]: perSecond(1)},
        expect: [],
      },
    ],
  };
}

/** Mean of a histogram per series, from targets with several sources */
function meanPerSeries(name, dashboard, panel) {
  return {
    dashboard,
    panel,
    refId: "A",
    cases: [
      {
        name: "several targets report the same source",
        series: {
          [`${name}_sum{${libp2p},source="block"}`]: perSecond(0.5),
          [`${name}_count{${libp2p},source="block"}`]: perSecond(1),
          [`${name}_sum{${native},source="block"}`]: perSecond(0.25),
          [`${name}_count{${native},source="block"}`]: perSecond(1),
        },
        expect: [
          {labels: `{${libp2p},source="block"}`, value: 0.5},
          {labels: `{${native},source="block"}`, value: 0.25},
        ],
      },
    ],
  };
}

/** A gauge the native backend exports as `lodestar_<name>` and js discv5 as `<name>` */
function discv5Gauge(name, panel) {
  return {
    dashboard: "lodestar_discv5.json",
    panel,
    refId: "A",
    cases: [
      {
        name: "native only",
        series: {[`lodestar_${name}{${native}}`]: constant(12)},
        expect: [{labels: `lodestar_${name}{${native}}`, value: 12}],
      },
      {
        name: "libp2p only",
        series: {[`${name}{${libp2p}}`]: constant(30)},
        expect: [{labels: `${name}{${libp2p}}`, value: 30}],
      },
      {
        name: "mixed targets keep their own series and zeros",
        series: {[`lodestar_${name}{${native}}`]: constant(0), [`${name}{${libp2p}}`]: constant(30)},
        expect: [
          {labels: `lodestar_${name}{${native}}`, value: 0},
          {labels: `${name}{${libp2p}}`, value: 30},
        ],
      },
      {
        name: "a target exporting both names reads the native one, its zero included",
        series: {[`lodestar_${name}{${native}}`]: constant(0), [`${name}{${native}}`]: constant(30)},
        expect: [{labels: `lodestar_${name}{${native}}`, value: 0}],
      },
      {
        name: "neither name exported has no result",
        series: {[`lodestar_discv5_decode_enr_attempt_count{${libp2p}}`]: perSecond(1)},
        expect: [],
      },
    ],
  };
}

/** A js discv5 message counter by type, which the native backend does not export */
function discv5Messages(name, panel) {
  return {
    dashboard: "lodestar_discv5.json",
    panel,
    refId: "A",
    cases: [
      {
        name: "libp2p reports, native has no producer",
        series: {
          [`${name}{${libp2p},type="PING"}`]: perSecond(2),
          [`lodestar_discv5_kad_table_size{${native}}`]: constant(12),
        },
        expect: [{labels: `{${libp2p},type="PING"}`, value: 2}],
      },
    ],
  };
}

export const fixtures = [
  slowRequests("beacon_reqresp_incoming_request_handler_time_seconds", "lodestar_networking.json", 605),
  slowRequests("beacon_reqresp_outgoing_request_roundtrip_time_seconds", "lodestar_networking.json", 606),
  {
    dashboard: "lodestar_networking.json",
    panel: 602,
    refId: "B",
    cases: [
      {
        name: "blocks processed within 1 s across targets with either le spelling",
        series: {
          [`lodestar_gossip_block_elapsed_time_till_processed_bucket{${libp2p},le="1"}`]: perSecond(1),
          [`lodestar_gossip_block_elapsed_time_till_processed_count{${libp2p}}`]: perSecond(2),
          [`lodestar_gossip_block_elapsed_time_till_processed_bucket{${native},le="1.0"}`]: perSecond(1),
          [`lodestar_gossip_block_elapsed_time_till_processed_bucket{${native},le="2.0"}`]: perSecond(2),
          [`lodestar_gossip_block_elapsed_time_till_processed_count{${native}}`]: perSecond(2),
        },
        expect: [{labels: "{}", value: 0.5}],
      },
    ],
  },
  {
    dashboard: "lodestar_networking.json",
    panel: 604,
    refId: "B",
    cases: [
      {
        name: "blocks received within 1 s by source, with either le spelling",
        series: {
          [`lodestar_gossip_block_elapsed_time_till_received_bucket{${libp2p},source="gossip",le="1"}`]: perSecond(1),
          [`lodestar_gossip_block_elapsed_time_till_received_count{${libp2p},source="gossip"}`]: perSecond(2),
          [`lodestar_gossip_block_elapsed_time_till_received_bucket{${native},source="gossip",le="1.0"}`]: perSecond(1),
          [`lodestar_gossip_block_elapsed_time_till_received_count{${native},source="gossip"}`]: perSecond(2),
          [`lodestar_gossip_block_elapsed_time_till_received_bucket{${native},source="api",le="1.0"}`]: perSecond(1),
          [`lodestar_gossip_block_elapsed_time_till_received_count{${native},source="api"}`]: perSecond(1),
        },
        expect: [
          {labels: '{source="gossip"}', value: 0.5},
          {labels: '{source="api"}', value: 1},
        ],
      },
    ],
  },
  {
    dashboard: "lodestar_summary.json",
    panel: 536,
    refId: "A",
    cases: [
      {
        name: "late imports per target, with either le spelling",
        series: {
          [`lodestar_gossip_block_elapsed_time_till_processed_count{${libp2p}}`]: perSecond(2),
          [`lodestar_gossip_block_elapsed_time_till_processed_bucket{${libp2p},le="4"}`]: perSecond(1.5),
          [`lodestar_gossip_block_elapsed_time_till_processed_count{${native}}`]: perSecond(2),
          [`lodestar_gossip_block_elapsed_time_till_processed_bucket{${native},le="4.0"}`]: perSecond(2),
        },
        expect: [
          {labels: `{${libp2p}}`, value: 0.5},
          {labels: `{${native}}`, value: 0},
        ],
      },
    ],
  },
  {
    dashboard: "lodestar_validator_monitor.json",
    panel: 32,
    refId: "A",
    cases: [
      {
        name: "share of attestations sent to zero peers per target, with either le spelling",
        series: {
          [`validator_monitor_unaggregated_attestation_submitted_sent_peers_count_bucket{${libp2p},le="0"}`]:
            perSecond(1),
          [`validator_monitor_unaggregated_attestation_submitted_sent_peers_count_bucket{${libp2p},le="1"}`]:
            perSecond(2),
          [`validator_monitor_unaggregated_attestation_submitted_sent_peers_count_count{${libp2p}}`]: perSecond(4),
          [`validator_monitor_unaggregated_attestation_submitted_sent_peers_count_bucket{${native},le="0.0"}`]:
            perSecond(0),
          [`validator_monitor_unaggregated_attestation_submitted_sent_peers_count_count{${native}}`]: perSecond(4),
        },
        expect: [
          {labels: `{${libp2p}}`, value: 0.25},
          {labels: `{${native}}`, value: 0},
        ],
      },
    ],
  },
  {
    dashboard: "lodestar_execution_engine.json",
    panel: 478,
    refId: "A",
    cases: [
      {
        name: "requests over 1 s by route, with either le spelling",
        series: {
          [`lodestar_execution_engine_http_client_request_time_seconds_bucket{${libp2p},routeId="getPayload",le="1"}`]:
            perSecond(3),
          [`lodestar_execution_engine_http_client_request_time_seconds_count{${libp2p},routeId="getPayload"}`]:
            perSecond(4),
          [`lodestar_execution_engine_http_client_request_time_seconds_bucket{${native},routeId="getPayload",le="1.0"}`]:
            perSecond(3),
          [`lodestar_execution_engine_http_client_request_time_seconds_count{${native},routeId="getPayload"}`]:
            perSecond(4),
        },
        expect: [{labels: '{routeId="getPayload"}', value: 0.25}],
      },
    ],
  },
  {
    dashboard: "lodestar_debug_gossipsub.json",
    panel: 477,
    refId: "3",
    cases: [
      {
        name: "peers with behaviour penalty in (3, 6] across targets, with either le spelling",
        series: {
          [`gossipsub_peer_stat_behaviour_penalty_bucket{${libp2p},le="3"}`]: constant(5),
          [`gossipsub_peer_stat_behaviour_penalty_bucket{${libp2p},le="6"}`]: constant(8),
          [`gossipsub_peer_stat_behaviour_penalty_bucket{${libp2pOther},le="3.0"}`]: constant(1),
          [`gossipsub_peer_stat_behaviour_penalty_bucket{${libp2pOther},le="6.0"}`]: constant(2),
        },
        expect: [{labels: "{}", value: 4}],
      },
    ],
  },
  {
    dashboard: "lodestar_debug_gossipsub.json",
    panel: 470,
    refId: "broken_ratio",
    cases: [
      {
        name: "promises delivered after 48 s against broken promises, with either le spelling",
        series: {
          [`gossipsub_iwant_promise_delivery_seconds_bucket{${libp2p},le="48"}`]: perSecond(1),
          [`gossipsub_iwant_promise_delivery_seconds_bucket{${libp2p},le="+Inf"}`]: perSecond(2),
          [`gossipsub_iwant_promise_delivery_seconds_bucket{${libp2pOther},le="48.0"}`]: perSecond(1),
          [`gossipsub_iwant_promise_delivery_seconds_bucket{${libp2pOther},le="+Inf"}`]: perSecond(2),
          [`gossipsub_iwant_promise_broken{${libp2p}}`]: perSecond(2),
          [`gossipsub_iwant_promise_broken{${libp2pOther}}`]: perSecond(2),
        },
        expect: [{labels: "{}", value: 0.5}],
      },
    ],
  },
  {
    dashboard: "lodestar_networking.json",
    panel: 38,
    refId: "A",
    cases: [
      {
        name: "connect events of every status per target and direction",
        series: {
          [`lodestar_peer_connected_total{${libp2p},direction="inbound",status="open"}`]: constant(7),
          [`lodestar_peer_connected_total{${libp2p},direction="inbound",status="closed"}`]: constant(3),
          [`lodestar_peer_disconnected_total{${libp2p},direction="inbound"}`]: constant(6),
          [`lodestar_peers_by_direction_count{${libp2p},direction="inbound"}`]: constant(4),
          [`lodestar_peer_connected_total{${libp2pOther},direction="inbound",status="open"}`]: constant(5),
          [`lodestar_peer_disconnected_total{${libp2pOther},direction="inbound"}`]: constant(3),
          [`lodestar_peers_by_direction_count{${libp2pOther},direction="inbound"}`]: constant(1),
          [`lodestar_native_peer_closes_total{${native},reason="host"}`]: constant(2),
        },
        expect: [
          {labels: `{${libp2p},direction="inbound"}`, value: 0},
          {labels: `{${libp2pOther},direction="inbound"}`, value: 1},
        ],
      },
    ],
  },
  {
    dashboard: "lodestar_networking.json",
    panel: 333,
    refId: "A",
    cases: [
      {
        name: "mean receive-to-import time per target",
        series: {
          [`lodestar_gossip_block_received_to_block_import_sum{${libp2p}}`]: perSecond(0.5),
          [`lodestar_gossip_block_received_to_block_import_count{${libp2p}}`]: perSecond(1),
          [`lodestar_gossip_block_received_to_block_import_sum{${native}}`]: perSecond(0.75),
          [`lodestar_gossip_block_received_to_block_import_count{${native}}`]: perSecond(1),
        },
        expect: [
          {labels: `{${libp2p}}`, value: 0.5},
          {labels: `{${native}}`, value: 0.75},
        ],
      },
    ],
  },
  {
    dashboard: "lodestar_sync.json",
    panel: 341,
    refId: "B",
    cases: [
      {
        name: "peers not syncing per target; a target without the sync peer count has none",
        series: {
          [`lodestar_peers_sync_count{${libp2p}}`]: constant(10),
          [`lodestar_sync_range_sync_peers{${libp2p},syncType="Finalized"}`]: constant(3),
          [`lodestar_sync_range_sync_peers{${libp2p},syncType="Head"}`]: constant(2),
          [`lodestar_peers_sync_count{${libp2pOther}}`]: constant(4),
          [`lodestar_sync_range_sync_peers{${libp2pOther},syncType="Finalized"}`]: constant(4),
          [`lodestar_sync_range_sync_peers{${native},syncType="Finalized"}`]: constant(6),
        },
        expect: [
          {labels: `{${libp2p}}`, value: 5},
          {labels: `{${libp2pOther}}`, value: 0},
        ],
      },
    ],
  },
  meanPerSeries("lodestar_stfn_hash_tree_root_seconds", "lodestar_block_processor.json", 526),
  meanPerSeries(
    "lodestar_historical_state_stfn_hash_tree_root_seconds",
    "lodestar_historical_state_regen.json",
    526
  ),
  discv5Gauge("discv5_kad_table_size", 26),
  discv5Gauge("discv5_active_session_count", 24),
  discv5Messages("discv5_rcvd_message_count", 20),
  discv5Messages("discv5_sent_message_count", 18),
  {
    dashboard: "lodestar_discv5.json",
    panel: 22,
    refId: "A",
    cases: [
      {
        name: "libp2p reports connected peers, native has no producer",
        series: {
          [`discv5_connected_peer_count{${libp2p}}`]: constant(25),
          [`lodestar_discv5_kad_table_size{${native}}`]: constant(12),
        },
        expect: [{labels: `discv5_connected_peer_count{${libp2p}}`, value: 25}],
      },
    ],
  },
  {
    dashboard: "lodestar_discv5.json",
    panel: 14,
    refId: "B",
    cases: [
      {
        name: "libp2p lookups per second",
        series: {[`discv5_lookup_count{${libp2p}}`]: perSecond(0.25)},
        expect: [{labels: `{${libp2p}}`, value: 0.25}],
      },
    ],
  },
];
