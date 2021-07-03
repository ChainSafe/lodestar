import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/default";
import {ForkName} from "@chainsafe/lodestar-params";
import {ssz} from "@chainsafe/lodestar-types";
import {stringifyGossipTopic, GossipType, GossipEncoding, GossipTopicMap} from "../../../../src/network/gossip";
import {ForkDigestContext} from "../../../../src/util/forkDigestContext";

describe("network / gossip / topic", function () {
  const genesisValidatorsRoot = ssz.Root.defaultValue();
  const forkDigestContext = new ForkDigestContext(config, genesisValidatorsRoot);
  const encoding = GossipEncoding.ssz_snappy;

  // Enforce with Typescript that we test all GossipType
  const testCases: {[K in GossipType]: {topic: GossipTopicMap[K]; topicStr: string}[]} = {
    [GossipType.beacon_block]: [
      {
        topic: {type: GossipType.beacon_block, fork: ForkName.phase0, encoding},
        topicStr: "/eth2/18ae4ccb/beacon_block/ssz_snappy",
      },
    ],
    [GossipType.beacon_aggregate_and_proof]: [
      {
        topic: {type: GossipType.beacon_aggregate_and_proof, fork: ForkName.phase0, encoding},
        topicStr: "/eth2/18ae4ccb/beacon_aggregate_and_proof/ssz_snappy",
      },
    ],
    [GossipType.beacon_attestation]: [
      {
        topic: {type: GossipType.beacon_attestation, fork: ForkName.phase0, subnet: 5, encoding},
        topicStr: "/eth2/18ae4ccb/beacon_attestation_5/ssz_snappy",
      },
    ],
    [GossipType.voluntary_exit]: [
      {
        topic: {type: GossipType.voluntary_exit, fork: ForkName.phase0, encoding},
        topicStr: "/eth2/18ae4ccb/voluntary_exit/ssz_snappy",
      },
    ],
    [GossipType.proposer_slashing]: [
      {
        topic: {type: GossipType.proposer_slashing, fork: ForkName.phase0, encoding},
        topicStr: "/eth2/18ae4ccb/proposer_slashing/ssz_snappy",
      },
    ],
    [GossipType.attester_slashing]: [
      {
        topic: {type: GossipType.attester_slashing, fork: ForkName.phase0, encoding},
        topicStr: "/eth2/18ae4ccb/attester_slashing/ssz_snappy",
      },
    ],
    [GossipType.sync_committee_contribution_and_proof]: [
      {
        topic: {type: GossipType.sync_committee_contribution_and_proof, fork: ForkName.altair, encoding},
        topicStr: "/eth2/8e04f66f/sync_committee_contribution_and_proof/ssz_snappy",
      },
    ],
    [GossipType.sync_committee]: [
      {
        topic: {type: GossipType.sync_committee, fork: ForkName.altair, subnet: 5, encoding},
        topicStr: "/eth2/8e04f66f/sync_committee_5/ssz_snappy",
      },
    ],
  };

  for (const topics of Object.values(testCases)) {
    if (topics.length === 0) throw Error("Must have a least 1 testCase for each GossipType");

    for (const {topic, topicStr} of topics) {
      it(`should encode gossip topic ${topic.type} ${topic.fork} ${topic.encoding}`, async () => {
        const topicStrRes = stringifyGossipTopic(forkDigestContext, topic);
        expect(topicStrRes).to.equal(topicStr);
      });
    }
  }
});
