// Canned series for `check-grafana-dashboard-queries.mjs`.
//
// Each fixture names one dashboard query. Each case maps series to promtool's expanding notation, sampled every
// minute for 40 minutes, and lists the samples the query returns at 40m. An empty `expect` means no result: a missing
// producer must stay missing rather than read as zero.

const native = 'instance="native",job="beacon"';
const nativeOther = 'instance="native-2",job="beacon"';
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

/**
 * Cases for a query over native families: a native target, a libp2p target alone, and two native targets beside a
 * libp2p target. `series` and `expect` describe one native target, with `%T` for its labels.
 */
function nativeQuery(dashboard, panel, refId, series, expect) {
  const place = (target, text) => text.replace("%T", target);
  const seriesOf = (target) => Object.fromEntries(Object.entries(series).map(([name, values]) => [place(target, name), values]));
  const expectOf = (target) => expect.map(({labels, value}) => ({labels: place(target, labels), value}));
  const libp2pSeries = {[`lodestar_peer_connected_total{${libp2p},direction="inbound",status="open"}`]: constant(3)};
  return {
    dashboard,
    panel,
    refId,
    cases: [
      {name: "native target", series: seriesOf(native), expect: expectOf(native)},
      {name: "a libp2p target has no result", series: libp2pSeries, expect: []},
      {
        name: "two native targets beside a libp2p target",
        series: {...seriesOf(native), ...seriesOf(nativeOther), ...libp2pSeries},
        expect: [...expectOf(native), ...expectOf(nativeOther)],
      },
    ],
  };
}

/** A gauge the native backend exports as `lodestar_<name>` and js discv5 as `<name>` */
function discv5Gauge(name, panel) {
  return {
    dashboard: "lodestar_native_network.json",
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

export const fixtures = [
  discv5Gauge("discv5_active_session_count", 24),
  discv5Gauge("discv5_kad_table_size", 26),
  ...networkingNative(),
  ...debugGossipsubNative(),
  ...discv5Native(),
  ...vmHostNative(),
  ...gossipScores(),
  ...gossipMessages(),
  ...peerReportsAndDialTime(),
];

/** Peer, gossip processor, serving and transport queries */
function networkingNative() {
  const file = "lodestar_native_network.json";
  return [
    nativeQuery(
      file,
      647,
      "A",
      {
        'lodestar_native_peer_closes_total{%T,reason="count_pruning"}': perSecond(0.5),
        'lodestar_native_peer_closes_total{%T,reason="remote_goodbye"}': perSecond(0),
      },
      [
        {labels: '{%T,reason="count_pruning"}', value: 30},
        {labels: '{%T,reason="remote_goodbye"}', value: 0},
      ]
    ),
    ...selectedAttempts(file, 648),
    nativeQuery(file, 643, "D", {"lodestar_native_peer_outbound_deficit{%T}": constant(2)}, [
      {labels: "lodestar_native_peer_outbound_deficit{%T}", value: 2},
    ]),
    {
      dashboard: file,
      panel: 649,
      refId: "A",
      cases: [
        {
          name: "outbound share per target on both backends, a real zero included",
          series: {
            [`lodestar_peers_by_direction_count{${libp2p},direction="inbound"}`]: constant(6),
            [`lodestar_peers_by_direction_count{${libp2p},direction="outbound"}`]: constant(2),
            [`lodestar_peers_by_direction_count{${native},direction="inbound"}`]: constant(5),
            [`lodestar_peers_by_direction_count{${native},direction="outbound"}`]: constant(0),
          },
          expect: [
            {labels: `{${libp2p}}`, value: 0.25},
            {labels: `{${native}}`, value: 0},
          ],
        },
        {
          name: "a target without outbound peers exported has no result",
          series: {[`lodestar_peers_by_direction_count{${native},direction="inbound"}`]: constant(5)},
          expect: [],
        },
      ],
    },
    nativeQuery(
      file,
      652,
      "A",
      {
        'lodestar_native_gossip_processor_items{%T,kind="beacon_attestation",state="queued"}': constant(7),
        'lodestar_native_gossip_processor_items{%T,kind="beacon_attestation",state="waiting"}': constant(4),
      },
      [{labels: 'lodestar_native_gossip_processor_items{%T,kind="beacon_attestation",state="queued"}', value: 7}]
    ),
    nativeQuery(
      file,
      653,
      "A",
      {
        'lodestar_native_gossip_processor_items{%T,kind="beacon_attestation",state="waiting"}': constant(4),
        'lodestar_native_gossip_processor_items{%T,kind="beacon_attestation",state="queued"}': constant(7),
      },
      [{labels: 'lodestar_native_gossip_processor_items{%T,kind="beacon_attestation",state="waiting"}', value: 4}]
    ),
    nativeQuery(
      file,
      653,
      "B",
      {'lodestar_native_gossip_processor_items{%T,kind="beacon_aggregate_and_proof",state="checking"}': constant(0)},
      [{labels: 'lodestar_native_gossip_processor_items{%T,kind="beacon_aggregate_and_proof",state="checking"}', value: 0}]
    ),
    nativeQuery(
      file,
      654,
      "A",
      {
        'lodestar_native_gossip_processor_items{%T,kind="beacon_block",state="executing"}': constant(5),
        'lodestar_native_gossip_processor_items{%T,kind="beacon_block",state="queued"}': constant(9),
        'lodestar_native_gossip_processor_execution_credit_limit{%T,kind="beacon_block",credit="items"}': constant(20),
        'lodestar_native_gossip_processor_execution_credit_limit{%T,kind="beacon_block",credit="bytes"}': constant(4096),
      },
      [{labels: '{%T,kind="beacon_block"}', value: 0.25}]
    ),
    nativeQuery(
      file,
      655,
      "A",
      {'lodestar_native_gossip_processor_refusals_total{%T,kind="beacon_attestation",reason="ineligible"}': perSecond(0.5)},
      [{labels: '{%T,kind="beacon_attestation",reason="ineligible"}', value: 6}]
    ),
    nativeQuery(
      file,
      655,
      "B",
      {'lodestar_native_gossipsub_storage_refusals_total{%T,reason="payload_capacity"}': perSecond(0.25)},
      [{labels: '{%T,reason="payload_capacity"}', value: 3}]
    ),
    nativeQuery(
      file,
      657,
      "A",
      {'lodestar_native_reqresp_admission_refusals_total{%T,method="status",reason="peer_quota"}': perSecond(0.5)},
      [{labels: '{%T,method="status",reason="peer_quota"}', value: 0.5}]
    ),
    {
      dashboard: file,
      panel: 658,
      refId: "A",
      cases: [
        {
          name: "dial timeouts per target on both backends, not other reasons",
          series: {
            [`beacon_reqresp_outgoing_requests_error_reason_total{${libp2p},reason="REQUEST_ERROR_DIAL_TIMEOUT"}`]:
              perSecond(0.5),
            [`beacon_reqresp_outgoing_requests_error_reason_total{${libp2p},reason="REQUEST_ERROR_DIAL_ERROR"}`]:
              perSecond(1),
            [`beacon_reqresp_outgoing_requests_error_reason_total{${native},reason="REQUEST_ERROR_DIAL_TIMEOUT"}`]:
              perSecond(0),
          },
          expect: [
            {labels: `{${libp2p},reason="REQUEST_ERROR_DIAL_TIMEOUT"}`, value: 0.5},
            {labels: `{${native},reason="REQUEST_ERROR_DIAL_TIMEOUT"}`, value: 0},
          ],
        },
      ],
    },
    ...[
      [659, "A", "lodestar_native_reqresp_resources_serving_occupied", 5],
      [659, "B", "lodestar_native_reqresp_resources_retiring", 1],
      [659, "C", "lodestar_native_reqresp_resources_serving_capacity", 32],
      [660, "B", "lodestar_native_host_serving_source_pending_bytes", 0],
      [662, "A", "lodestar_native_quic_connections_active", 40],
      [662, "B", "lodestar_native_quic_connections_handshaking", 3],
    ].map(([panel, refId, name, value]) =>
      nativeQuery(file, panel, refId, {[`${name}{%T}`]: constant(value)}, [{labels: `${name}{%T}`, value}])
    ),
    nativeQuery(
      file,
      660,
      "A",
      {
        'lodestar_native_host_serving_reserved_bytes{%T,scope="total"}': constant(4096),
        'lodestar_native_host_serving_reserved_bytes{%T,scope="source"}': constant(1024),
      },
      [
        {labels: 'lodestar_native_host_serving_reserved_bytes{%T,scope="total"}', value: 4096},
        {labels: 'lodestar_native_host_serving_reserved_bytes{%T,scope="source"}', value: 1024},
      ]
    ),
    nativeQuery(
      file,
      663,
      "A",
      {'lodestar_native_quic_connections_established_total{%T,direction="inbound"}': perSecond(0.5)},
      [{labels: '{%T,direction="inbound"}', value: 30}]
    ),
    nativeQuery(
      file,
      663,
      "B",
      {'lodestar_native_quic_connections_closed_total{%T,direction="outbound",reason="handshake_timeout"}': perSecond(0.25)},
      [{labels: '{%T,direction="outbound",reason="handshake_timeout"}', value: 15}]
    ),
    ...[
      [664, "A", "lodestar_native_quic_udp_received_bytes_total"],
      [664, "B", "lodestar_native_quic_udp_sent_bytes_total"],
      [665, "A", "lodestar_native_quic_udp_received_datagrams_total"],
      [665, "B", "lodestar_native_quic_udp_sent_datagrams_total"],
    ].map(([panel, refId, name]) =>
      nativeQuery(file, panel, refId, {[`${name}{%T}`]: perSecond(2)}, [{labels: "{%T}", value: 2}])
    ),
    nativeQuery(
      file,
      666,
      "A",
      {'lodestar_native_udp_socket_drops_total{%T,family="ip4",role="quic"}': perSecond(0.5)},
      [{labels: '{%T,family="ip4",role="quic"}', value: 0.5}]
    ),
    nativeQuery(
      file,
      667,
      "A",
      {'lodestar_native_udp_socket_buffer_bytes{%T,direction="receive",family="ip4",role="quic"}': constant(8388608)},
      [{labels: 'lodestar_native_udp_socket_buffer_bytes{%T,direction="receive",family="ip4",role="quic"}', value: 8388608}]
    ),
  ];
}

/** Applied verdicts and gossip resource use */
function debugGossipsubNative() {
  const file = "lodestar_native_network.json";
  const verdicts = {
    [`gossipsub_accepted_messages_total{${libp2p},topic="beacon_attestation"}`]: perSecond(3),
    [`gossipsub_ignored_messages_total{${libp2p},topic="beacon_attestation"}`]: perSecond(1),
    [`gossipsub_rejected_messages_total{${libp2p},topic="beacon_attestation"}`]: perSecond(0),
    [`gossipsub_accepted_messages_total{${native},topic="beacon_attestation"}`]: perSecond(1),
    [`gossipsub_ignored_messages_total{${native},topic="beacon_attestation"}`]: perSecond(1),
    [`gossipsub_rejected_messages_total{${native},topic="beacon_attestation"}`]: perSecond(2),
    [`gossipsub_accepted_messages_total{${libp2p},topic="voluntary_exit"}`]: perSecond(1),
    [`gossipsub_ignored_messages_total{${libp2p},topic="voluntary_exit"}`]: perSecond(1),
  };
  return [
    {
      dashboard: file,
      panel: 514,
      refId: "A",
      cases: [
        {
          name: "accepted messages per target on both backends",
          series: verdicts,
          expect: [
            {labels: `{${libp2p},topic="beacon_attestation"}`, value: 3},
            {labels: `{${native},topic="beacon_attestation"}`, value: 1},
            {labels: `{${libp2p},topic="voluntary_exit"}`, value: 1},
          ],
        },
        {
          name: "a target without verdicts has no result",
          series: {[`lodestar_native_peer_below_target{${native}}`]: constant(0)},
          expect: [],
        },
      ],
    },
    {
      dashboard: file,
      panel: 515,
      refId: "A",
      cases: [
        {
          name: "ignored share of applied verdicts per topic across backends",
          series: verdicts,
          expect: [
            {labels: '{topic="beacon_attestation"}', value: 0.25},
            {labels: '{topic="voluntary_exit"}', value: 0.5},
          ],
        },
      ],
    },
    {
      dashboard: file,
      panel: 515,
      refId: "B",
      cases: [
        {
          name: "rejected share per topic; a topic never rejected has no result, not a zero",
          series: verdicts,
          expect: [{labels: '{topic="beacon_attestation"}', value: 0.25}],
        },
      ],
    },
    nativeQuery(
      file,
      517,
      "A",
      {
        'lodestar_native_gossip_data_recipients_total{%T,origin="forward",outcome="completed"}': perSecond(3),
        'lodestar_native_gossip_data_recipients_total{%T,origin="iwant",outcome="queued"}': perSecond(1),
      },
      [{labels: '{%T,origin="forward",outcome="completed"}', value: 3}]
    ),
    {
      dashboard: file,
      panel: 518,
      refId: "A",
      cases: [
        {
          name: "native recipients queued per forwarded message; a libp2p forward count alone has no result",
          series: {
            [`lodestar_native_gossip_data_recipients_total{${native},origin="forward",outcome="queued"}`]: perSecond(4),
            [`lodestar_native_gossip_data_recipients_total{${native},origin="forward",outcome="completed"}`]:
              perSecond(3),
            [`gossipsub_msg_forward_count_total{${native},topic="beacon_block"}`]: perSecond(1),
            [`gossipsub_msg_forward_count_total{${native},topic="beacon_attestation"}`]: perSecond(1),
            [`gossipsub_msg_forward_count_total{${libp2p},topic="beacon_attestation"}`]: perSecond(1),
          },
          expect: [{labels: `{${native}}`, value: 2}],
        },
      ],
    },
    nativeQuery(file, 519, "A", {'lodestar_native_gossip_iwant_ids_total{%T,outcome="miss"}': perSecond(0.5)}, [
      {labels: '{%T,outcome="miss"}', value: 0.5},
    ]),
    ...[
      [520, "A", "lodestar_native_gossipsub_pending_validations", 12],
      [520, "B", "lodestar_native_gossipsub_validation_capacity", 4096],
      [521, "A", "lodestar_native_gossipsub_receive_pages", 0],
      [521, "B", "lodestar_native_gossipsub_receive_page_capacity", 512],
      [521, "C", "lodestar_native_gossipsub_store_pages", 40],
      [522, "B", "lodestar_native_gossipsub_delivery_descriptors_capacity", 100],
      [523, "A", "lodestar_native_gossipsub_queued_bytes", 65536],
    ].map(([panel, refId, name, value]) =>
      nativeQuery(file, panel, refId, {[`${name}{%T}`]: constant(value)}, [{labels: `${name}{%T}`, value}])
    ),
    nativeQuery(
      file,
      522,
      "A",
      {
        "lodestar_native_gossipsub_delivery_descriptors_capacity{%T}": constant(100),
        "lodestar_native_gossipsub_delivery_descriptors_available{%T}": constant(60),
      },
      [{labels: "{%T}", value: 40}]
    ),
  ];
}

/** Selected attempts and their outcomes */
function selectedAttempts(dashboard, panel) {
  return [
    nativeQuery(dashboard, panel, "A", {'lodestar_native_peer_dial_selections_total{%T,source="discovery"}': perSecond(1)}, [
      {labels: '{%T,source="discovery"}', value: 60},
    ]),
    nativeQuery(
      dashboard,
      panel,
      "B",
      {
        'lodestar_native_peer_dial_outcomes_total{%T,outcome="connected"}': perSecond(0.25),
        'lodestar_native_peer_dial_outcomes_total{%T,outcome="deferred"}': perSecond(0.5),
      },
      [
        {labels: '{%T,outcome="connected"}', value: 15},
        {labels: '{%T,outcome="deferred"}', value: 30},
      ]
    ),
  ];
}

/** Discovery queries */
function discv5Native() {
  const file = "lodestar_native_network.json";
  return [
    nativeQuery(file, 56, "A", {"lodestar_native_discovery_lookups_started_total{%T}": perSecond(0.25)}, [
      {labels: "{%T}", value: 15},
    ]),
    nativeQuery(
      file,
      56,
      "B",
      {'lodestar_native_discovery_lookup_finishes_total{%T,reason="converged"}': perSecond(0.25)},
      [{labels: '{%T,reason="converged"}', value: 15}]
    ),
    nativeQuery(file, 57, "A", {"lodestar_native_discovery_candidates_published_total{%T}": perSecond(0.5)}, [
      {labels: "{%T}", value: 30},
    ]),
    nativeQuery(
      file,
      57,
      "B",
      {'lodestar_native_discovery_candidate_rejections_total{%T,reason="missing_eth2"}': perSecond(1)},
      [{labels: '{%T,reason="missing_eth2"}', value: 60}]
    ),
    nativeQuery(
      file,
      58,
      "A",
      {
        'lodestar_native_discovery_datagram_rejections_total{%T,reason="malformed_packet",stage="packet"}': perSecond(0.25),
        'lodestar_native_discovery_datagram_rejections_total{%T,reason="admission_limited",stage="admission"}': perSecond(1),
      },
      [
        {labels: '{%T,reason="malformed_packet",stage="packet"}', value: 15},
        {labels: '{%T,reason="admission_limited",stage="admission"}', value: 60},
      ]
    ),
  ];
}

/** Owner step histogram queries, including the Prometheus 3 spelling of an integer bound */
function vmHostNative() {
  const file = "lodestar_native_network.json";
  const steps = {
    'lodestar_native_network_step_seconds_bucket{%T,le="0.5"}': perSecond(1),
    'lodestar_native_network_step_seconds_bucket{%T,le="1.0"}': perSecond(2),
    'lodestar_native_network_step_seconds_bucket{%T,le="+Inf"}': perSecond(2),
    "lodestar_native_network_step_seconds_sum{%T}": perSecond(0.5),
    "lodestar_native_network_step_seconds_count{%T}": perSecond(2),
  };
  return [
    nativeQuery(file, 565, "A", steps, [{labels: "{%T}", value: 0.5}]),
    nativeQuery(file, 565, "B", steps, [{labels: "{%T}", value: 0.99}]),
    nativeQuery(file, 565, "C", steps, [{labels: "{%T}", value: 0.25}]),
    nativeQuery(file, 566, "A", steps, [{labels: "{%T}", value: 0.5}]),
  ];
}

/**
 * Score-threshold populations and score statistics of connected gossip peers, shared with libp2p's panels, and of mesh
 * peers in the native row. A population without peers has no statistics, which must stay missing rather than zero.
 */
function gossipScores() {
  const networking = "lodestar_native_network.json";
  const debug = "lodestar_native_network.json";
  const populations = {
    'lodestar_native_gossip_score_peers{%T,scope="connected",threshold="all"}': constant(50),
    'lodestar_native_gossip_score_peers{%T,scope="connected",threshold="graylist"}': constant(48),
    'lodestar_native_gossip_score_peers{%T,scope="connected",threshold="nonnegative"}': constant(0),
    'lodestar_native_gossip_score_peers{%T,scope="mesh",threshold="all"}': constant(20),
  };
  const connected = (name) => [
    {labels: `${name}{%T,scope="connected",threshold="all"}`, value: 50},
    {labels: `${name}{%T,scope="connected",threshold="graylist"}`, value: 48},
    {labels: `${name}{%T,scope="connected",threshold="nonnegative"}`, value: 0},
  ];
  /** Statistics of one scope: a target whose population is empty exports none */
  const statistics = (dashboard, panel, refId, scope) => {
    const other = scope === "mesh" ? "connected" : "mesh";
    const stats = (target) => ({
      [`lodestar_native_gossip_score_peers{${target},scope="${scope}",threshold="all"}`]: constant(3),
      [`lodestar_native_gossip_score{${target},scope="${scope}",stat="min"}`]: constant(-12.5),
      [`lodestar_native_gossip_score{${target},scope="${scope}",stat="mean"}`]: constant(0),
      [`lodestar_native_gossip_score{${target},scope="${scope}",stat="max"}`]: constant(40),
      [`lodestar_native_gossip_score{${target},scope="${other}",stat="max"}`]: constant(7),
    });
    const expect = (target) => [
      {labels: `lodestar_native_gossip_score{${target},scope="${scope}",stat="min"}`, value: -12.5},
      {labels: `lodestar_native_gossip_score{${target},scope="${scope}",stat="mean"}`, value: 0},
      {labels: `lodestar_native_gossip_score{${target},scope="${scope}",stat="max"}`, value: 40},
    ];
    const empty = {[`lodestar_native_gossip_score_peers{${nativeOther},scope="${scope}",threshold="all"}`]: constant(0)};
    return {
      dashboard,
      panel,
      refId,
      cases: [
        {name: "native target, a real zero mean included", series: stats(native), expect: expect(native)},
        {name: "an empty population has no statistics, not zeros", series: empty, expect: []},
        {
          name: "a libp2p target has no native statistics",
          series: {[`lodestar_gossip_score_avg_min_max_max{${libp2p}}`]: constant(9)},
          expect: [],
        },
        {
          name: "a native target beside an empty one and a libp2p target",
          series: {...stats(native), ...empty, [`gossipsub_score_max{${libp2p}}`]: constant(9)},
          expect: expect(native),
        },
      ],
    };
  };
  return [
    nativeQuery(networking, 330, "B", populations, connected("lodestar_native_gossip_score_peers")),
    nativeQuery(
      debug,
      524,
      "A",
      {...populations, 'lodestar_native_gossip_score_peers{%T,scope="mesh",threshold="publish"}': constant(0)},
      [
        {labels: 'lodestar_native_gossip_score_peers{%T,scope="mesh",threshold="all"}', value: 20},
        {labels: 'lodestar_native_gossip_score_peers{%T,scope="mesh",threshold="publish"}', value: 0},
      ]
    ),
    statistics(networking, 331, "native", "connected"),
    statistics(debug, 525, "A", "mesh"),
  ];
}

/**
 * Received, duplicate and published messages, mesh changes, P7 penalties and sampled IWANT promises. Panels that read
 * equivalent libp2p and native counters take each target's own counter with `or` before summing.
 */
function gossipMessages() {
  const file = "lodestar_native_network.json";
  /** A per-target counter rate on both backends, by topic */
  const eitherCounter = (panel, libp2pName, nativeName) => ({
    dashboard: file,
    panel,
    refId: "A",
    cases: [
      {
        name: "libp2p only",
        series: {[`${libp2pName}{${libp2p},topic="beacon_block"}`]: perSecond(2)},
        expect: [{labels: `{${libp2p},topic="beacon_block"}`, value: 2}],
      },
      {
        name: "native only, a real zero included",
        series: {
          [`${nativeName}{${native},topic="beacon_block"}`]: perSecond(3),
          [`${nativeName}{${native},topic="unknown"}`]: perSecond(0),
        },
        expect: [
          {labels: `{${native},topic="beacon_block"}`, value: 3},
          {labels: `{${native},topic="unknown"}`, value: 0},
        ],
      },
      {
        name: "mixed targets keep their own series",
        series: {
          [`${libp2pName}{${libp2p},topic="beacon_block"}`]: perSecond(2),
          [`${nativeName}{${native},topic="beacon_block"}`]: perSecond(3),
          [`${nativeName}{${nativeOther},topic="beacon_block"}`]: perSecond(1),
        },
        expect: [
          {labels: `{${libp2p},topic="beacon_block"}`, value: 2},
          {labels: `{${native},topic="beacon_block"}`, value: 3},
          {labels: `{${nativeOther},topic="beacon_block"}`, value: 1},
        ],
      },
      {
        name: "a target without either counter has no result, not a zero",
        series: {[`gossipsub_accepted_messages_total{${native},topic="beacon_block"}`]: perSecond(1)},
        expect: [],
      },
    ],
  });
  const promises = {
    [`gossipsub_iwant_promise_broken{${libp2p}}`]: perSecond(1),
    [`gossipsub_iwant_promise_sent_total{${libp2p}}`]: perSecond(4),
    [`gossipsub_iwant_promise_broken{${native}}`]: perSecond(0.5),
    [`lodestar_native_gossip_iwant_promises_started_total{${native}}`]: perSecond(2),
    [`gossipsub_iwant_promise_broken{${nativeOther}}`]: perSecond(0),
    [`lodestar_native_gossip_iwant_promises_started_total{${nativeOther}}`]: perSecond(2),
  };
  /** Committed joins (M) or leaves (N) summed over targets by reason; leaves plot below zero */
  const meshChanges = (refId, event, sign) => {
    const changes = (target) => ({
      [`lodestar_native_gossip_mesh_changes_total{${target},topic="beacon_attestation",event="join",reason="fill_mesh"}`]:
        perSecond(0.5),
      [`lodestar_native_gossip_mesh_changes_total{${target},topic="beacon_block",event="join",reason="remote_graft"}`]:
        perSecond(0),
      [`lodestar_native_gossip_mesh_changes_total{${target},topic="beacon_block",event="leave",reason="excess"}`]:
        perSecond(0.25),
      [`lodestar_native_gossip_mesh_changes_total{${target},topic="unknown",event="leave",reason="session_end"}`]:
        perSecond(0),
    });
    const reasons = event === "join" ? {fill_mesh: 0.5, remote_graft: 0} : {excess: 0.25, session_end: 0};
    const expect = (targets) =>
      Object.entries(reasons).map(([reason, rate]) => ({labels: `{reason="${reason}"}`, value: sign * rate * targets}));
    return {
      dashboard: file,
      panel: 386,
      refId,
      cases: [
        {name: `native ${event}s by reason, real zeros included`, series: changes(native), expect: expect(1)},
        {
          name: "a libp2p target has no native result",
          series: {[`gossipsub_mesh_peer_inclusion_events_random_total{${libp2p},topic="beacon_block"}`]: perSecond(1)},
          expect: [],
        },
        {
          name: "two native targets beside a libp2p target sum by reason",
          series: {
            ...changes(native),
            ...changes(nativeOther),
            [`gossipsub_peer_churn_events_prune_total{${libp2p},topic="beacon_block"}`]: perSecond(1),
          },
          expect: expect(2),
        },
      ],
    };
  };
  return [
    eitherCounter(424, "gossipsub_msg_received_prevalidation_total", "lodestar_native_gossip_messages_received_total"),
    eitherCounter(411, "gossipsub_msg_publish_count_total", "lodestar_native_gossip_messages_published_total"),
    {
      dashboard: file,
      panel: 425,
      refId: "A",
      cases: [
        {
          name: "libp2p only, light client topics excluded",
          series: {
            [`gossipsub_pre_validation_duplicate_total{${libp2p},topic="beacon_attestation"}`]: perSecond(1),
            [`gossipsub_msg_received_prevalidation_total{${libp2p},topic="beacon_attestation"}`]: perSecond(4),
            [`gossipsub_pre_validation_duplicate_total{${libp2p},topic="light_client_finality_update"}`]: perSecond(1),
            [`gossipsub_msg_received_prevalidation_total{${libp2p},topic="light_client_finality_update"}`]: perSecond(1),
          },
          expect: [{labels: '{topic="beacon_attestation"}', value: 0.25}],
        },
        {
          name: "native only, a topic without duplicates reads zero",
          series: {
            [`lodestar_native_gossip_messages_duplicate_total{${native},topic="beacon_attestation"}`]: perSecond(3),
            [`lodestar_native_gossip_messages_received_total{${native},topic="beacon_attestation"}`]: perSecond(4),
            [`lodestar_native_gossip_messages_duplicate_total{${native},topic="beacon_block"}`]: perSecond(0),
            [`lodestar_native_gossip_messages_received_total{${native},topic="beacon_block"}`]: perSecond(2),
          },
          expect: [
            {labels: '{topic="beacon_attestation"}', value: 0.75},
            {labels: '{topic="beacon_block"}', value: 0},
          ],
        },
        {
          name: "mixed targets sum their own counters",
          series: {
            [`gossipsub_pre_validation_duplicate_total{${libp2p},topic="beacon_attestation"}`]: perSecond(1),
            [`gossipsub_msg_received_prevalidation_total{${libp2p},topic="beacon_attestation"}`]: perSecond(4),
            [`lodestar_native_gossip_messages_duplicate_total{${native},topic="beacon_attestation"}`]: perSecond(3),
            [`lodestar_native_gossip_messages_received_total{${native},topic="beacon_attestation"}`]: perSecond(4),
          },
          expect: [{labels: '{topic="beacon_attestation"}', value: 0.5}],
        },
        {
          name: "no received counter has no result",
          series: {[`gossipsub_accepted_messages_total{${native},topic="beacon_attestation"}`]: perSecond(1)},
          expect: [],
        },
      ],
    },
    {
      dashboard: file,
      panel: 433,
      refId: "A",
      cases: [
        {
          name: "libp2p received per nonduplicate",
          series: {
            [`gossipsub_msg_received_prevalidation_total{${libp2p},topic="beacon_block"}`]: perSecond(6),
            [`gossipsub_pre_validation_duplicate_total{${libp2p},topic="beacon_block"}`]: perSecond(4),
            [`gossipsub_pre_validation_valid_total{${libp2p},topic="beacon_block"}`]: perSecond(1),
          },
          expect: [{labels: '{topic="beacon_block"}', value: 3}],
        },
        {
          name: "native received per nonduplicate",
          series: {
            [`lodestar_native_gossip_messages_received_total{${native},topic="beacon_block"}`]: perSecond(6),
            [`lodestar_native_gossip_messages_duplicate_total{${native},topic="beacon_block"}`]: perSecond(4),
          },
          expect: [{labels: '{topic="beacon_block"}', value: 3}],
        },
        {
          name: "identical traffic reads the same on either backend and mixed",
          series: {
            [`gossipsub_msg_received_prevalidation_total{${libp2p},topic="beacon_block"}`]: perSecond(6),
            [`gossipsub_pre_validation_duplicate_total{${libp2p},topic="beacon_block"}`]: perSecond(4),
            [`lodestar_native_gossip_messages_received_total{${native},topic="beacon_block"}`]: perSecond(6),
            [`lodestar_native_gossip_messages_duplicate_total{${native},topic="beacon_block"}`]: perSecond(4),
          },
          expect: [{labels: '{topic="beacon_block"}', value: 3}],
        },
        {
          name: "a target without duplicate series for a topic counts none; a topic without any reads 1",
          series: {
            [`gossipsub_msg_received_prevalidation_total{${libp2p},topic="beacon_block"}`]: perSecond(6),
            [`gossipsub_msg_received_prevalidation_total{${libp2pOther},topic="beacon_block"}`]: perSecond(6),
            [`gossipsub_pre_validation_duplicate_total{${libp2pOther},topic="beacon_block"}`]: perSecond(8),
            [`gossipsub_msg_received_prevalidation_total{${libp2p},topic="voluntary_exit"}`]: perSecond(1),
            [`lodestar_native_gossip_messages_received_total{${native},topic="voluntary_exit"}`]: perSecond(1),
            [`lodestar_native_gossip_messages_duplicate_total{${native},topic="voluntary_exit"}`]: perSecond(0),
          },
          expect: [
            {labels: '{topic="beacon_block"}', value: 3},
            {labels: '{topic="voluntary_exit"}', value: 1},
          ],
        },
        {
          name: "libp2p creates duplicate series lazily, so a topic never duplicated anywhere reads 1",
          series: {[`gossipsub_msg_received_prevalidation_total{${libp2p},topic="proposer_slashing"}`]: perSecond(1)},
          expect: [{labels: '{topic="proposer_slashing"}', value: 1}],
        },
        {
          name: "no received counter has no result",
          series: {[`gossipsub_pre_validation_valid_total{${libp2p},topic="beacon_block"}`]: perSecond(2)},
          expect: [],
        },
      ],
    },
    {
      dashboard: file,
      panel: 412,
      refId: "B",
      cases: [
        {
          name: "native recipients queued per publication across topics, another origin or outcome excluded",
          series: {
            [`lodestar_native_gossip_data_recipients_total{${native},origin="publication",outcome="queued"}`]: perSecond(8),
            [`lodestar_native_gossip_data_recipients_total{${native},origin="publication",outcome="selected"}`]: perSecond(9),
            [`lodestar_native_gossip_data_recipients_total{${native},origin="forward",outcome="queued"}`]: perSecond(90),
            [`lodestar_native_gossip_messages_published_total{${native},topic="beacon_attestation"}`]: perSecond(1),
            [`lodestar_native_gossip_messages_published_total{${native},topic="beacon_block"}`]: perSecond(1),
          },
          expect: [{labels: `{${native}}`, value: 4}],
        },
        {
          name: "publications without recipients read zero per target; libp2p has no native result",
          series: {
            [`lodestar_native_gossip_data_recipients_total{${native},origin="publication",outcome="queued"}`]: perSecond(0),
            [`lodestar_native_gossip_messages_published_total{${native},topic="beacon_attestation"}`]: perSecond(1),
            [`lodestar_native_gossip_data_recipients_total{${nativeOther},origin="publication",outcome="queued"}`]:
              perSecond(6),
            [`lodestar_native_gossip_messages_published_total{${nativeOther},topic="beacon_attestation"}`]: perSecond(2),
            [`gossipsub_msg_publish_peers_total{${libp2p},topic="beacon_attestation"}`]: perSecond(8),
            [`gossipsub_msg_publish_count_total{${libp2p},topic="beacon_attestation"}`]: perSecond(1),
          },
          expect: [
            {labels: `{${native}}`, value: 0},
            {labels: `{${nativeOther}}`, value: 3},
          ],
        },
      ],
    },
    meshChanges("M", "join", 1),
    meshChanges("N", "leave", -1),
    nativeQuery(file, 462, "D", {"lodestar_native_gossip_iwant_promises_started_total{%T}": perSecond(2)}, [
      {labels: "{%T}", value: 2},
    ]),
    {
      dashboard: file,
      panel: 462,
      refId: "E",
      cases: [
        {
          name: "native broken per armed promise per target, a real zero included; libp2p has no armed promises",
          series: promises,
          expect: [
            {labels: `{${native}}`, value: 0.25},
            {labels: `{${nativeOther}}`, value: 0},
          ],
        },
      ],
    },
    nativeQuery(
      file,
      526,
      "A",
      {
        'lodestar_native_gossip_behaviour_penalties_total{%T,reason="broken_iwant"}': perSecond(0.5),
        'lodestar_native_gossip_behaviour_penalties_total{%T,reason="graft_flood"}': perSecond(0),
      },
      [
        {labels: '{%T,reason="broken_iwant"}', value: 0.5},
        {labels: '{%T,reason="graft_flood"}', value: 0},
      ]
    ),
  ];
}

/** Host peer report submissions beside libp2p's, and the native time from selecting an attempt to its outcome */
function peerReportsAndDialTime() {
  const buckets = (target, le) => ({
    [`lodestar_native_peer_dial_time_seconds_bucket{${target},outcome="connected",le="0.25"}`]: perSecond(16),
    [`lodestar_native_peer_dial_time_seconds_bucket{${target},outcome="connected",le="${le}"}`]: perSecond(20),
    [`lodestar_native_peer_dial_time_seconds_bucket{${target},outcome="connected",le="+Inf"}`]: perSecond(20),
  });
  return [
    nativeQuery(
      "lodestar_native_network.json",
      507,
      "B",
      {
        'lodestar_native_peer_reports_total{%T,reason="BadGossipBlock",action="low_tolerance"}': perSecond(0.5),
        'lodestar_native_peer_reports_total{%T,reason="BadGossipBlock",action="mid_tolerance"}': perSecond(0.25),
        'lodestar_native_peer_reports_total{%T,reason="other",action="fatal"}': perSecond(0),
      },
      [
        {labels: '{%T,reason="BadGossipBlock"}', value: 0.75},
        {labels: '{%T,reason="other"}', value: 0},
      ]
    ),
    nativeQuery(
      "lodestar_native_network.json",
      60,
      "A",
      {
        'lodestar_native_peer_dial_time_seconds_sum{%T,outcome="connected"}': perSecond(0.5),
        'lodestar_native_peer_dial_time_seconds_count{%T,outcome="connected"}': perSecond(2),
        'lodestar_native_peer_dial_time_seconds_sum{%T,outcome="deferred"}': perSecond(0.1),
        'lodestar_native_peer_dial_time_seconds_count{%T,outcome="deferred"}': perSecond(1),
      },
      [
        {labels: '{%T,outcome="connected"}', value: 0.25},
        {labels: '{%T,outcome="deferred"}', value: 0.1},
      ]
    ),
    {
      dashboard: "lodestar_native_network.json",
      panel: 60,
      refId: "B",
      cases: [
        {
          name: "p95 per target and outcome with either le spelling; a libp2p dial histogram has no result",
          series: {
            ...buckets(native, "1.0"),
            ...buckets(nativeOther, "1"),
            [`lodestar_discovery_dial_time_seconds_bucket{${libp2p},status="success",le="5"}`]: perSecond(1),
            [`lodestar_discovery_dial_time_seconds_bucket{${libp2p},status="success",le="+Inf"}`]: perSecond(1),
          },
          expect: [
            {labels: `{${native},outcome="connected"}`, value: 0.8125},
            {labels: `{${nativeOther},outcome="connected"}`, value: 0.8125},
          ],
        },
      ],
    },
  ];
}
