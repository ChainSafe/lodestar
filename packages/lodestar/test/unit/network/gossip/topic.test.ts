import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/minimal";

import {
  getGossipTopic,
  getGossipTopicString,
  GossipType,
  GossipTopic,
  DEFAULT_ENCODING,
} from "../../../../src/network/gossip";

describe("GossipTopic", function () {
  it("should round trip encode/decode gossip topics", async () => {
    const genesisValidatorsRoot = Buffer.alloc(32);
    const topics: GossipTopic[] = [
      {type: GossipType.beacon_block, fork: "phase0", encoding: DEFAULT_ENCODING},
      {type: GossipType.beacon_aggregate_and_proof, fork: "phase0", encoding: DEFAULT_ENCODING},
      {type: GossipType.beacon_attestation, fork: "phase0", subnet: 5, encoding: DEFAULT_ENCODING},
      {type: GossipType.voluntary_exit, fork: "phase0", encoding: DEFAULT_ENCODING},
      {type: GossipType.proposer_slashing, fork: "phase0", encoding: DEFAULT_ENCODING},
      {type: GossipType.attester_slashing, fork: "phase0", encoding: DEFAULT_ENCODING},
    ];
    for (const topic of topics) {
      const topicString = getGossipTopicString(config, topic, genesisValidatorsRoot);
      const outputTopic = getGossipTopic(config, topicString, genesisValidatorsRoot);
      expect(outputTopic).to.deep.equal(topic);
    }
  });
  it("should fail to decode invalid gossip topic strings", async () => {
    const genesisValidatorsRoot = Buffer.alloc(32);
    const topicStrings: string[] = [
      // completely invalid
      "/different/protocol/entirely",
      // invalid fork digest
      "/eth2/ffffffff/beacon_attestation_5/ssz_snappy",
      // invalid gossip type
      "/eth2/18ae4ccb/beacon_attestation_foo/ssz_snappy",
      // invalid gossip type
      "/eth2/18ae4ccb/something_different/ssz_snappy",
      // invalid encoding
      "/eth2/18ae4ccb/beacon_attestation_5/ssz_supersnappy",
    ];
    for (const topicString of topicStrings) {
      expect(() => getGossipTopic(config, topicString, genesisValidatorsRoot), topicString).to.throw();
    }
  });
});
