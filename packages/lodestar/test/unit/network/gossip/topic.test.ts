import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/mainnet";
import {ForkName} from "@chainsafe/lodestar-config";
import {
  getGossipTopic,
  getGossipTopicString,
  GossipType,
  GossipTopic,
  DEFAULT_ENCODING,
} from "../../../../src/network/gossip";
import {ForkDigestContext} from "../../../../src/util/forkDigestContext";

describe("GossipTopic", function () {
  const genesisValidatorsRoot = config.types.Root.defaultValue();
  const forkDigestContext = new ForkDigestContext(config, genesisValidatorsRoot);

  const topics: GossipTopic[] = [
    {type: GossipType.beacon_block, fork: ForkName.phase0, encoding: DEFAULT_ENCODING},
    {type: GossipType.beacon_aggregate_and_proof, fork: ForkName.phase0, encoding: DEFAULT_ENCODING},
    {type: GossipType.beacon_attestation, fork: ForkName.phase0, subnet: 5, encoding: DEFAULT_ENCODING},
    {type: GossipType.voluntary_exit, fork: ForkName.phase0, encoding: DEFAULT_ENCODING},
    {type: GossipType.proposer_slashing, fork: ForkName.phase0, encoding: DEFAULT_ENCODING},
    {type: GossipType.attester_slashing, fork: ForkName.phase0, encoding: DEFAULT_ENCODING},
  ];
  for (const topic of topics) {
    it(`should round trip encode/decode gossip topic ${topic.type} ${topic.fork} ${topic.encoding}`, async () => {
      const topicString = getGossipTopicString(forkDigestContext, topic);
      const outputTopic = getGossipTopic(forkDigestContext, topicString);
      expect(outputTopic).to.deep.equal(topic);
    });
  }

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
    it(`should fail to decode invalid gossip topic string ${topicString}`, async () => {
      expect(() => getGossipTopic(forkDigestContext, topicString), topicString).to.throw();
    });
  }
});
