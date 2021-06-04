import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/default";
import {ForkName} from "@chainsafe/lodestar-params";
import {ssz} from "@chainsafe/lodestar-types";
import {
  parseGossipTopic,
  stringifyGossipTopic,
  GossipType,
  GossipEncoding,
  GossipTopicMap,
} from "../../../../src/network/gossip";
import {ForkDigestContext} from "../../../../src/util/forkDigestContext";

describe("GossipTopic", function () {
  const genesisValidatorsRoot = ssz.Root.defaultValue();
  const forkDigestContext = new ForkDigestContext(config, genesisValidatorsRoot);
  const encoding = GossipEncoding.ssz_snappy;

  // Enforce with Typescript that we test all GossipType
  const testCases: {[K in GossipType]: GossipTopicMap[K][]} = {
    [GossipType.beacon_block]: [{type: GossipType.beacon_block, fork: ForkName.phase0, encoding}],
    [GossipType.beacon_aggregate_and_proof]: [
      {type: GossipType.beacon_aggregate_and_proof, fork: ForkName.phase0, encoding},
    ],
    [GossipType.beacon_attestation]: [
      {type: GossipType.beacon_attestation, fork: ForkName.phase0, subnet: 5, encoding},
    ],
    [GossipType.voluntary_exit]: [{type: GossipType.voluntary_exit, fork: ForkName.phase0, encoding}],
    [GossipType.proposer_slashing]: [{type: GossipType.proposer_slashing, fork: ForkName.phase0, encoding}],
    [GossipType.attester_slashing]: [{type: GossipType.attester_slashing, fork: ForkName.phase0, encoding}],
    [GossipType.sync_committee_contribution_and_proof]: [
      {type: GossipType.sync_committee_contribution_and_proof, fork: ForkName.phase0, encoding},
    ],
    [GossipType.sync_committee]: [{type: GossipType.sync_committee, fork: ForkName.phase0, subnet: 5, encoding}],
  };

  for (const topics of Object.values(testCases)) {
    if (topics.length === 0) throw Error("Must have a least 1 testCase for each GossipType");

    for (const topic of topics) {
      it(`should round trip encode/decode gossip topic ${topic.type} ${topic.fork} ${topic.encoding}`, async () => {
        const topicString = stringifyGossipTopic(forkDigestContext, topic);
        const outputTopic = parseGossipTopic(forkDigestContext, topicString);
        expect(outputTopic).to.deep.equal(topic);
      });
    }
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
    "/eth2/18ae4ccb/beacon_attestation/ssz_snappy",
    "/eth2/18ae4ccb/beacon_attestation_/ssz_snappy",
    "/eth2/18ae4ccb/beacon_attestation_PP/ssz_snappy",
    // invalid encoding
    "/eth2/18ae4ccb/beacon_attestation_5/ssz_supersnappy",
  ];
  for (const topicString of topicStrings) {
    it(`should fail to decode invalid gossip topic string ${topicString}`, async () => {
      expect(() => parseGossipTopic(forkDigestContext, topicString), topicString).to.throw();
    });
  }
});
