import {describe, expect, it} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {config as chainConfig} from "@lodestar/config/default";
import {
  ATTESTATION_SUBNET_COUNT,
  ForkName,
  GENESIS_EPOCH,
  MAX_ATTESTER_SLASHING_SIZE,
  MAX_DATA_COLUMN_SIDECAR_SIZE,
  MAX_SIGNED_AGGREGATE_AND_PROOF_SIZE,
  MAX_SIGNED_EXECUTION_PAYLOAD_BID_SIZE,
  MAX_SIGNED_EXECUTION_PAYLOAD_BID_SIZE_HEZE,
  ZERO_HASH,
} from "@lodestar/params";
import {DataTransformSnappy} from "../../../../src/network/gossip/encoding.js";
import {GossipEncoding, GossipTopicMap, GossipType} from "../../../../src/network/gossip/index.js";
import {
  GossipTopicCache,
  getAllowedTopics,
  getCoreTopicsAtFork,
  getGossipSSZMaxSize,
  getGossipSSZType,
  gossipTopicAllowPublishToZeroPeers,
  parseGossipTopic,
  stringifyGossipTopic,
} from "../../../../src/network/gossip/topic.js";
import {NetworkConfig} from "../../../../src/network/networkConfig.js";
import {computeNodeId} from "../../../../src/network/subnets/index.js";
import {CustodyConfig} from "../../../../src/util/dataColumns.js";
import {getValidPeerId} from "../../../utils/peer.js";

describe("network / gossip / topic", () => {
  const config = createBeaconConfig({...chainConfig, GLOAS_FORK_EPOCH: 700000}, ZERO_HASH);
  const encoding = GossipEncoding.ssz_snappy;

  // Enforce with Typescript that we test all GossipType
  const testCases: {[K in GossipType]: {topic: GossipTopicMap[K]; topicStr: string}[]} = {
    [GossipType.beacon_block]: [
      {
        topic: {type: GossipType.beacon_block, boundary: {fork: ForkName.phase0, epoch: GENESIS_EPOCH}, encoding},
        topicStr: "/eth2/f5a5fd42/beacon_block/ssz_snappy",
      },
    ],
    [GossipType.data_column_sidecar]: [
      {
        topic: {
          type: GossipType.data_column_sidecar,
          subnet: 1,
          boundary: {fork: ForkName.fulu, epoch: config.FULU_FORK_EPOCH},
          encoding,
        },
        topicStr: "/eth2/4ba67af9/data_column_sidecar_1/ssz_snappy",
      },
    ],
    [GossipType.beacon_aggregate_and_proof]: [
      {
        topic: {
          type: GossipType.beacon_aggregate_and_proof,
          boundary: {fork: ForkName.phase0, epoch: GENESIS_EPOCH},
          encoding,
        },
        topicStr: "/eth2/f5a5fd42/beacon_aggregate_and_proof/ssz_snappy",
      },
    ],
    [GossipType.beacon_attestation]: [
      {
        topic: {
          type: GossipType.beacon_attestation,
          boundary: {fork: ForkName.phase0, epoch: GENESIS_EPOCH},
          subnet: 5,
          encoding,
        },
        topicStr: "/eth2/f5a5fd42/beacon_attestation_5/ssz_snappy",
      },
    ],
    [GossipType.voluntary_exit]: [
      {
        topic: {type: GossipType.voluntary_exit, boundary: {fork: ForkName.phase0, epoch: GENESIS_EPOCH}, encoding},
        topicStr: "/eth2/f5a5fd42/voluntary_exit/ssz_snappy",
      },
    ],
    [GossipType.bls_to_execution_change]: [
      {
        topic: {
          type: GossipType.bls_to_execution_change,
          boundary: {fork: ForkName.capella, epoch: config.CAPELLA_FORK_EPOCH},
          encoding,
        },
        topicStr: "/eth2/e7b4bb67/bls_to_execution_change/ssz_snappy",
      },
    ],
    [GossipType.proposer_slashing]: [
      {
        topic: {
          type: GossipType.proposer_slashing,
          boundary: {fork: ForkName.phase0, epoch: GENESIS_EPOCH},
          encoding,
        },
        topicStr: "/eth2/f5a5fd42/proposer_slashing/ssz_snappy",
      },
    ],
    [GossipType.attester_slashing]: [
      {
        topic: {
          type: GossipType.attester_slashing,
          boundary: {fork: ForkName.phase0, epoch: GENESIS_EPOCH},
          encoding,
        },
        topicStr: "/eth2/f5a5fd42/attester_slashing/ssz_snappy",
      },
    ],
    [GossipType.sync_committee_contribution_and_proof]: [
      {
        topic: {
          type: GossipType.sync_committee_contribution_and_proof,
          boundary: {fork: ForkName.altair, epoch: config.ALTAIR_FORK_EPOCH},
          encoding,
        },
        topicStr: "/eth2/16abab34/sync_committee_contribution_and_proof/ssz_snappy",
      },
    ],
    [GossipType.sync_committee]: [
      {
        topic: {
          type: GossipType.sync_committee,
          boundary: {fork: ForkName.altair, epoch: config.ALTAIR_FORK_EPOCH},
          subnet: 5,
          encoding,
        },
        topicStr: "/eth2/16abab34/sync_committee_5/ssz_snappy",
      },
    ],
    [GossipType.light_client_finality_update]: [
      {
        topic: {
          type: GossipType.light_client_finality_update,
          boundary: {fork: ForkName.altair, epoch: config.ALTAIR_FORK_EPOCH},
          encoding,
        },
        topicStr: "/eth2/16abab34/light_client_finality_update/ssz_snappy",
      },
    ],
    [GossipType.light_client_optimistic_update]: [
      {
        topic: {
          type: GossipType.light_client_optimistic_update,
          boundary: {fork: ForkName.altair, epoch: config.ALTAIR_FORK_EPOCH},
          encoding,
        },
        topicStr: "/eth2/16abab34/light_client_optimistic_update/ssz_snappy",
      },
    ],
    [GossipType.execution_payload]: [
      {
        topic: {
          type: GossipType.execution_payload,
          boundary: {fork: ForkName.gloas, epoch: config.GLOAS_FORK_EPOCH},
          encoding,
        },
        topicStr: "/eth2/a41d57bd/execution_payload/ssz_snappy",
      },
    ],
    [GossipType.payload_attestation_message]: [
      {
        topic: {
          type: GossipType.payload_attestation_message,
          boundary: {fork: ForkName.gloas, epoch: config.GLOAS_FORK_EPOCH},
          encoding,
        },
        topicStr: "/eth2/a41d57bd/payload_attestation_message/ssz_snappy",
      },
    ],
    [GossipType.execution_payload_bid]: [
      {
        topic: {
          type: GossipType.execution_payload_bid,
          boundary: {fork: ForkName.gloas, epoch: config.GLOAS_FORK_EPOCH},
          encoding,
        },
        topicStr: "/eth2/a41d57bd/execution_payload_bid/ssz_snappy",
      },
    ],
    [GossipType.proposer_preferences]: [
      {
        topic: {
          type: GossipType.proposer_preferences,
          boundary: {fork: ForkName.gloas, epoch: config.GLOAS_FORK_EPOCH},
          encoding,
        },
        topicStr: "/eth2/a41d57bd/proposer_preferences/ssz_snappy",
      },
    ],
  };

  for (const topics of Object.values(testCases)) {
    if (topics.length === 0) throw Error("Must have a least 1 testCase for each GossipType");

    for (const {topic, topicStr} of topics) {
      it(`should encode gossip topic ${topic.type} ${topic.boundary.fork} ${topic.encoding}`, async () => {
        const topicStrRes = stringifyGossipTopic(config, topic);
        expect(topicStrRes).toBe(topicStr);
      });

      it(`should decode gossip topic ${topicStr}`, async () => {
        const outputTopic = parseGossipTopic(config, topicStr);
        expect(outputTopic).toEqual(topic);
      });
    }
  }

  const badTopicStrings: string[] = [
    // completely invalid
    "/different/protocol/entirely",
    // invalid fork digest
    "/eth2/ffffffff/beacon_attestation_5/ssz_snappy",
    // invalid gossip type
    "/eth2/f5a5fd42/beacon_attestation_foo/ssz_snappy",
    // invalid gossip type
    "/eth2/f5a5fd42/something_different/ssz_snappy",
    "/eth2/f5a5fd42/beacon_attestation/ssz_snappy",
    "/eth2/f5a5fd42/beacon_attestation_/ssz_snappy",
    "/eth2/f5a5fd42/beacon_attestation_PP/ssz_snappy",
    // invalid encoding
    "/eth2/f5a5fd42/beacon_attestation_5/ssz_supersnappy",
  ];
  for (const topicStr of badTopicStrings) {
    it(`should fail to decode invalid gossip topic string ${topicStr}`, async () => {
      // topicStr
      expect(() => parseGossipTopic(config, topicStr)).toThrow();
    });
  }

  it("should provide finite gossip size limits for every gossip type", () => {
    for (const {topic} of Object.values(testCases).flat()) {
      const maxSize = getGossipSSZMaxSize(topic, config.MAX_PAYLOAD_SIZE);

      expect(Number.isFinite(maxSize)).toBe(true);
      expect(maxSize).toBeGreaterThanOrEqual(getGossipSSZType(topic).minSize);
    }
  });

  it("should use preset-defined gossip size limits for Gloas progressive objects", () => {
    const boundary = {fork: ForkName.gloas, epoch: config.GLOAS_FORK_EPOCH};

    expect({
      [GossipType.beacon_block]: getGossipSSZMaxSize(
        {type: GossipType.beacon_block, boundary, encoding},
        config.MAX_PAYLOAD_SIZE
      ),
      [GossipType.data_column_sidecar]: getGossipSSZMaxSize(
        {type: GossipType.data_column_sidecar, boundary, subnet: 1, encoding},
        config.MAX_PAYLOAD_SIZE
      ),
      [GossipType.beacon_aggregate_and_proof]: getGossipSSZMaxSize(
        {type: GossipType.beacon_aggregate_and_proof, boundary, encoding},
        config.MAX_PAYLOAD_SIZE
      ),
      [GossipType.attester_slashing]: getGossipSSZMaxSize(
        {type: GossipType.attester_slashing, boundary, encoding},
        config.MAX_PAYLOAD_SIZE
      ),
      [GossipType.execution_payload_bid]: getGossipSSZMaxSize(
        {type: GossipType.execution_payload_bid, boundary, encoding},
        config.MAX_PAYLOAD_SIZE
      ),
    }).toEqual({
      [GossipType.beacon_block]: config.MAX_PAYLOAD_SIZE,
      [GossipType.data_column_sidecar]: MAX_DATA_COLUMN_SIDECAR_SIZE,
      [GossipType.beacon_aggregate_and_proof]: MAX_SIGNED_AGGREGATE_AND_PROOF_SIZE,
      [GossipType.attester_slashing]: MAX_ATTESTER_SLASHING_SIZE,
      [GossipType.execution_payload_bid]: MAX_SIGNED_EXECUTION_PAYLOAD_BID_SIZE,
    });
  });

  it("should use the Heze bid size limit post-Heze", () => {
    const boundary = {fork: ForkName.heze, epoch: config.HEZE_FORK_EPOCH};

    expect(
      getGossipSSZMaxSize({type: GossipType.execution_payload_bid, boundary, encoding}, config.MAX_PAYLOAD_SIZE)
    ).toBe(MAX_SIGNED_EXECUTION_PAYLOAD_BID_SIZE_HEZE);
  });

  it("should cap Gloas progressive gossip objects below their theoretical SSZ max", () => {
    const boundary = {fork: ForkName.gloas, epoch: config.GLOAS_FORK_EPOCH};

    for (const topic of [
      {type: GossipType.beacon_block, boundary, encoding},
      {type: GossipType.beacon_aggregate_and_proof, boundary, encoding},
      {type: GossipType.attester_slashing, boundary, encoding},
      {type: GossipType.execution_payload, boundary, encoding},
      {type: GossipType.execution_payload_bid, boundary, encoding},
      {type: GossipType.data_column_sidecar, boundary, subnet: 1, encoding},
    ] as const) {
      expect(getGossipSSZMaxSize(topic, config.MAX_PAYLOAD_SIZE)).toBeLessThan(getGossipSSZType(topic).maxSize);
    }
  });

  it("should reject gossip bytes above the per-topic limit before outbound compression", () => {
    const topic = {
      type: GossipType.beacon_aggregate_and_proof,
      boundary: {fork: ForkName.gloas, epoch: config.GLOAS_FORK_EPOCH},
      encoding,
    } as const;
    const topicStr = stringifyGossipTopic(config, topic);
    const gossipTopicCache = new GossipTopicCache(config);
    const transform = new DataTransformSnappy(gossipTopicCache, config.MAX_PAYLOAD_SIZE, null);

    gossipTopicCache.setTopic(topicStr, topic);

    expect(() =>
      transform.outboundTransform(topicStr, new Uint8Array(MAX_SIGNED_AGGREGATE_AND_PROOF_SIZE + 1))
    ).toThrow(`ssz_snappy encoded data length ${MAX_SIGNED_AGGREGATE_AND_PROOF_SIZE + 1}`);
  });

  describe("getAllowedTopics", () => {
    // A config with every fork scheduled so all fork boundaries (and their topics) are present
    const allForksConfig = createBeaconConfig(
      {
        ...chainConfig,
        ALTAIR_FORK_EPOCH: 1,
        BELLATRIX_FORK_EPOCH: 2,
        CAPELLA_FORK_EPOCH: 3,
        DENEB_FORK_EPOCH: 4,
        ELECTRA_FORK_EPOCH: 5,
        FULU_FORK_EPOCH: 6,
        GLOAS_FORK_EPOCH: 7,
      },
      ZERO_HASH
    );
    const nodeId = computeNodeId(getValidPeerId());
    const networkConfig: NetworkConfig = {
      nodeId,
      config: allForksConfig,
      custodyConfig: new CustodyConfig({nodeId, config: allForksConfig}),
    };
    const allowedTopics = getAllowedTopics(networkConfig);

    const findBoundary = (fork: ForkName) => {
      const boundary = allForksConfig.forkBoundariesAscendingEpochOrder.find((b) => b.fork === fork);
      if (!boundary) throw Error(`no boundary for fork ${fork}`);
      return boundary;
    };

    it("is a superset of every topic the node may subscribe to across all forks", () => {
      for (const boundary of allForksConfig.forkBoundariesAscendingEpochOrder) {
        const topics = getCoreTopicsAtFork(networkConfig, boundary.fork, {
          subscribeAllSubnets: true,
          disableLightClientServer: false,
        });
        for (const topic of topics) {
          const topicStr = stringifyGossipTopic(allForksConfig, {...topic, boundary});
          expect(allowedTopics.has(topicStr), `missing subscribed topic ${topicStr}`).toBe(true);
        }
      }
    });

    it("includes all attestation subnets", () => {
      const boundary = findBoundary(ForkName.phase0);
      for (let subnet = 0; subnet < ATTESTATION_SUBNET_COUNT; subnet++) {
        const topicStr = stringifyGossipTopic(allForksConfig, {type: GossipType.beacon_attestation, subnet, boundary});
        expect(allowedTopics.has(topicStr), `missing ${topicStr}`).toBe(true);
      }
    });

    it("includes ALL data column subnets at fulu, not just the sampled ones", () => {
      const boundary = findBoundary(ForkName.fulu);
      for (let subnet = 0; subnet < allForksConfig.DATA_COLUMN_SIDECAR_SUBNET_COUNT; subnet++) {
        const topicStr = stringifyGossipTopic(allForksConfig, {
          type: GossipType.data_column_sidecar,
          subnet,
          boundary,
        });
        expect(allowedTopics.has(topicStr), `missing ${topicStr}`).toBe(true);
      }
    });

    it("only contains valid, parseable topic strings", () => {
      expect(allowedTopics.size).toBeGreaterThan(0);
      for (const topicStr of allowedTopics) {
        expect(() => parseGossipTopic(allForksConfig, topicStr), `unparseable allowed topic ${topicStr}`).not.toThrow();
      }
    });

    it("excludes attacker-controlled topics (out-of-range subnet, unknown digest, garbage)", () => {
      const boundary = findBoundary(ForkName.phase0);
      // Valid fork digest + format, but out-of-range attestation subnet
      const outOfRangeSubnet = stringifyGossipTopic(allForksConfig, {
        type: GossipType.beacon_attestation,
        subnet: 9999,
        boundary,
      });
      expect(allowedTopics.has(outOfRangeSubnet)).toBe(false);
      // Unknown fork digest
      expect(allowedTopics.has("/eth2/ffffffff/beacon_attestation_5/ssz_snappy")).toBe(false);
      // Garbage
      expect(allowedTopics.has("/attacker/garbage/topic")).toBe(false);
    });
  });

  describe("gossipTopicAllowPublishToZeroPeers", () => {
    it("has an entry for every gossip type", () => {
      for (const gossipType of Object.values(GossipType)) {
        expect(gossipTopicAllowPublishToZeroPeers[gossipType]).toBeTypeOf("boolean");
      }
    });

    it("only opts out for topics that tolerate reaching no peer", () => {
      const allowed = Object.values(GossipType).filter((type) => gossipTopicAllowPublishToZeroPeers[type]);

      // A publish that reached no peer is a failed broadcast and must surface to the caller. Adding a
      // topic here silently turns that failure into a success, so it should be a deliberate change.
      expect(allowed.sort()).toEqual(
        [
          GossipType.data_column_sidecar,
          GossipType.light_client_finality_update,
          GossipType.light_client_optimistic_update,
        ].sort()
      );
    });
  });
});
