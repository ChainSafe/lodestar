import {expect} from "chai";
import sinon, {SinonStubbedInstance} from "sinon";
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
  let forkDigestContext: SinonStubbedInstance<ForkDigestContext>;

  beforeEach(() => {
    forkDigestContext = sinon.createStubInstance(ForkDigestContext);
  });

  it("should round trip encode/decode gossip topics", async () => {
    const topics: GossipTopic[] = [
      {type: GossipType.beacon_block, fork: ForkName.phase0, encoding: DEFAULT_ENCODING},
      {type: GossipType.beacon_aggregate_and_proof, fork: ForkName.phase0, encoding: DEFAULT_ENCODING},
      {type: GossipType.beacon_attestation, fork: ForkName.phase0, subnet: 5, encoding: DEFAULT_ENCODING},
      {type: GossipType.voluntary_exit, fork: ForkName.phase0, encoding: DEFAULT_ENCODING},
      {type: GossipType.proposer_slashing, fork: ForkName.phase0, encoding: DEFAULT_ENCODING},
      {type: GossipType.attester_slashing, fork: ForkName.phase0, encoding: DEFAULT_ENCODING},
    ];
    for (const topic of topics) {
      const topicString = getGossipTopicString(forkDigestContext, topic);
      const outputTopic = getGossipTopic(forkDigestContext, topicString);
      expect(outputTopic).to.deep.equal(topic);
    }
  });
  it("should fail to decode invalid gossip topic strings", async () => {
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
      expect(() => getGossipTopic(forkDigestContext, topicString), topicString).to.throw();
    }
  });
});
