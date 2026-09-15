import {describe, expect, it} from "vitest";
import {config} from "@lodestar/config/default";
import {
  ForkName,
  MAX_ATTESTER_SLASHING_SIZE,
  MAX_SIGNED_AGGREGATE_AND_PROOF_SIZE,
  MAX_SIGNED_EXECUTION_PAYLOAD_BID_SIZE,
  MAX_SIGNED_EXECUTION_PAYLOAD_BID_SIZE_HEZE,
} from "@lodestar/params";
import {GossipEncoding, GossipType} from "../../../../src/network/gossip/index.js";
import {getGossipSSZMaxSize} from "../../../../src/network/gossip/topic.js";
import {computeMaxGloasDataColumnSidecarSize} from "../../../../src/util/sszBytes.js";

describe("network / gossip / topic", () => {
  const encoding = GossipEncoding.ssz_snappy;
  const maxCol = computeMaxGloasDataColumnSidecarSize(config);

  // Gossip size limits are derived from the ssz types, ensure they match the preset p2p bounds for minimal as well.
  // data_column_sidecar is the exception: it's bounded by the blob-schedule-derived size (consensus-specs #5613).
  for (const fork of [ForkName.gloas, ForkName.heze]) {
    it(`should match the preset p2p size bounds for ${fork} progressive objects`, () => {
      const boundary = {fork, epoch: 0};

      expect({
        [GossipType.data_column_sidecar]: getGossipSSZMaxSize(
          {type: GossipType.data_column_sidecar, boundary, subnet: 1, encoding},
          config.MAX_PAYLOAD_SIZE,
          maxCol
        ),
        [GossipType.beacon_aggregate_and_proof]: getGossipSSZMaxSize(
          {type: GossipType.beacon_aggregate_and_proof, boundary, encoding},
          config.MAX_PAYLOAD_SIZE,
          maxCol
        ),
        [GossipType.attester_slashing]: getGossipSSZMaxSize(
          {type: GossipType.attester_slashing, boundary, encoding},
          config.MAX_PAYLOAD_SIZE,
          maxCol
        ),
        [GossipType.execution_payload_bid]: getGossipSSZMaxSize(
          {type: GossipType.execution_payload_bid, boundary, encoding},
          config.MAX_PAYLOAD_SIZE,
          maxCol
        ),
      }).toEqual({
        [GossipType.data_column_sidecar]: maxCol,
        [GossipType.beacon_aggregate_and_proof]: MAX_SIGNED_AGGREGATE_AND_PROOF_SIZE,
        [GossipType.attester_slashing]: MAX_ATTESTER_SLASHING_SIZE,
        [GossipType.execution_payload_bid]:
          fork === ForkName.heze ? MAX_SIGNED_EXECUTION_PAYLOAD_BID_SIZE_HEZE : MAX_SIGNED_EXECUTION_PAYLOAD_BID_SIZE,
      });
    });
  }
});
