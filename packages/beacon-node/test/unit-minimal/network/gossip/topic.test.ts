import {describe, expect, it} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {config} from "@lodestar/config/default";
import {
  ForkName,
  MAX_ATTESTER_SLASHING_SIZE,
  MAX_SIGNED_AGGREGATE_AND_PROOF_SIZE,
  MAX_SIGNED_EXECUTION_PAYLOAD_BID_SIZE,
  MAX_SIGNED_EXECUTION_PAYLOAD_BID_SIZE_HEZE,
  ZERO_HASH,
} from "@lodestar/params";
import {DataTransformSnappy} from "../../../../src/network/gossip/encoding.js";
import {GossipEncoding, GossipType} from "../../../../src/network/gossip/index.js";
import {GossipTopicCache, getGossipSSZMaxSize, stringifyGossipTopic} from "../../../../src/network/gossip/topic.js";
import {computeMaxGloasDataColumnSidecarSize} from "../../../../src/util/sszBytes.js";

describe("network / gossip / topic", () => {
  const encoding = GossipEncoding.ssz_snappy;
  // schedule all forks so gloas/heze topics can be stringified (fork digests exist per scheduled boundary)
  const beaconConfig = createBeaconConfig(
    {
      ...config,
      ALTAIR_FORK_EPOCH: 1,
      BELLATRIX_FORK_EPOCH: 2,
      CAPELLA_FORK_EPOCH: 3,
      DENEB_FORK_EPOCH: 4,
      ELECTRA_FORK_EPOCH: 5,
      FULU_FORK_EPOCH: 6,
      GLOAS_FORK_EPOCH: 7,
      HEZE_FORK_EPOCH: 8,
    },
    ZERO_HASH
  );
  const maxCol = computeMaxGloasDataColumnSidecarSize(config);

  // Gossip size limits are derived from the ssz types, ensure they match the preset p2p bounds for minimal as well.
  // data_column_sidecar is the exception: it's bounded by the blob-schedule-derived size (consensus-specs #5613),
  // enforced by DataTransformSnappy.
  for (const fork of [ForkName.gloas, ForkName.heze]) {
    it(`should match the preset p2p size bounds for ${fork} progressive objects`, () => {
      const boundary = {fork, epoch: 0};

      expect({
        [GossipType.beacon_aggregate_and_proof]: getGossipSSZMaxSize(
          {
            type: GossipType.beacon_aggregate_and_proof,
            boundary,
            encoding,
          },
          config.MAX_PAYLOAD_SIZE
        ),
        [GossipType.attester_slashing]: getGossipSSZMaxSize(
          {
            type: GossipType.attester_slashing,
            boundary,
            encoding,
          },
          config.MAX_PAYLOAD_SIZE
        ),
        [GossipType.execution_payload_bid]: getGossipSSZMaxSize(
          {
            type: GossipType.execution_payload_bid,
            boundary,
            encoding,
          },
          config.MAX_PAYLOAD_SIZE
        ),
      }).toEqual({
        [GossipType.beacon_aggregate_and_proof]: MAX_SIGNED_AGGREGATE_AND_PROOF_SIZE,
        [GossipType.attester_slashing]: MAX_ATTESTER_SLASHING_SIZE,
        [GossipType.execution_payload_bid]:
          fork === ForkName.heze ? MAX_SIGNED_EXECUTION_PAYLOAD_BID_SIZE_HEZE : MAX_SIGNED_EXECUTION_PAYLOAD_BID_SIZE,
      });
    });

    it(`should bound ${fork} data_column_sidecar by the blob-schedule-derived size`, () => {
      const topic = {
        type: GossipType.data_column_sidecar,
        boundary: {fork, epoch: fork === ForkName.heze ? beaconConfig.HEZE_FORK_EPOCH : beaconConfig.GLOAS_FORK_EPOCH},
        subnet: 1,
        encoding,
      } as const;
      const topicStr = stringifyGossipTopic(beaconConfig, topic);
      const gossipTopicCache = new GossipTopicCache(beaconConfig);
      const transform = new DataTransformSnappy(beaconConfig, gossipTopicCache, null);
      gossipTopicCache.setTopic(topicStr, topic);

      expect(() => transform.outboundTransform(topicStr, new Uint8Array(maxCol))).not.toThrow();
      expect(() => transform.outboundTransform(topicStr, new Uint8Array(maxCol + 1))).toThrow(
        `ssz_snappy encoded data length ${maxCol + 1}`
      );
    });
  }
});
