import {expect} from "chai";
import {TopicScoreParams} from "@chainsafe/libp2p-gossipsub/score";
import {ATTESTATION_SUBNET_COUNT, ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {createBeaconConfig} from "@lodestar/config";
import {mainnetChainConfig} from "@lodestar/config/presets";
import {computeGossipPeerScoreParams, gossipScoreThresholds} from "../../../../src/network/gossip/scoringParameters.js";
import {stringifyGossipTopic} from "../../../../src/network/gossip/topic.js";
import {GossipType} from "../../../../src/network/index.js";
import {ZERO_HASH} from "../../../../src/constants/index.js";

/**
 * Refer to Teku tests at
 * https://github.com/ConsenSys/teku/blob/e18ab9903442410aa04b590c4cc46734e13d3ffd/networking/eth2/src/test/java/tech/pegasys/teku/networking/eth2/gossip/config/GossipScoringConfiguratorTest.java#L38
 */
describe("computeGossipPeerScoreParams", function () {
  const config = createBeaconConfig(mainnetChainConfig, ZERO_HASH);
  // Cheap stub on new BeaconConfig instance
  config.forkName2ForkDigest = () => Buffer.alloc(4, 1);
  config.forkDigest2ForkName = () => ForkName.phase0;

  const TOLERANCE = 0.00005;

  it("at genesis", () => {
    const eth2Context = {
      activeValidatorCount: mainnetChainConfig.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT,
      currentSlot: 0,
      currentEpoch: 0,
    };
    expect(gossipScoreThresholds.gossipThreshold).to.be.equal(-4000);
    expect(gossipScoreThresholds.publishThreshold).to.be.equal(-8000);
    expect(gossipScoreThresholds.graylistThreshold).to.be.equal(-16000);
    expect(gossipScoreThresholds.acceptPXThreshold).to.be.equal(100);
    expect(gossipScoreThresholds.opportunisticGraftThreshold).to.be.equal(5);
    const params = computeGossipPeerScoreParams({config, eth2Context});
    const allTopics = params.topics;
    if (!allTopics) {
      throw new Error("No scoring params for topics");
    }
    validateVoluntaryExitTopicParams(allTopics);
    validateSlashingTopicParams(allTopics);
    validateAggregateTopicParams(allTopics, false);
    validateBlockTopicParams(allTopics, false);
    validateAllAttestationSubnetTopicParams(allTopics, false);
  });

  it("for mature chain", () => {
    const eth2Context = {
      activeValidatorCount: mainnetChainConfig.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT,
      currentSlot: 10_000,
      currentEpoch: Math.floor(10_000 / SLOTS_PER_EPOCH),
    };
    expect(gossipScoreThresholds.gossipThreshold).to.be.equal(-4000);
    expect(gossipScoreThresholds.publishThreshold).to.be.equal(-8000);
    expect(gossipScoreThresholds.graylistThreshold).to.be.equal(-16000);
    expect(gossipScoreThresholds.acceptPXThreshold).to.be.equal(100);
    expect(gossipScoreThresholds.opportunisticGraftThreshold).to.be.equal(5);
    const params = computeGossipPeerScoreParams({config, eth2Context});
    const allTopics = params.topics;
    if (!allTopics) {
      throw new Error("No scoring params for topics");
    }
    validateVoluntaryExitTopicParams(allTopics);
    validateSlashingTopicParams(allTopics);
    validateAggregateTopicParams(allTopics, true);
    validateBlockTopicParams(allTopics, true);
    validateAllAttestationSubnetTopicParams(allTopics, true);
  });

  function validateVoluntaryExitTopicParams(topics: Record<string, TopicScoreParams>): void {
    const topicString = stringifyGossipTopic(config, {
      type: GossipType.voluntary_exit,
      fork: ForkName.phase0,
    });
    const params = topics[topicString];
    assertMessageRatePenaltiesDisabled(params);
    expect(params.topicWeight).to.be.equal(0.05);
    expect(params.timeInMeshWeight).closeTo(0.03333, TOLERANCE);
    expect(params.timeInMeshQuantum).to.be.equal(12 * 1000);
    expect(params.timeInMeshCap).to.be.equal(300);
    expect(params.firstMessageDeliveriesWeight).closeTo(1.8407, TOLERANCE);
    expect(params.firstMessageDeliveriesDecay).closeTo(0.99856, TOLERANCE);
    expect(params.firstMessageDeliveriesCap).closeTo(21.73035, TOLERANCE);
    expect(params.invalidMessageDeliveriesWeight).closeTo(-2200, TOLERANCE);
    expect(params.invalidMessageDeliveriesDecay).closeTo(0.99713, TOLERANCE);
  }

  function validateSlashingTopicParams(topics: Record<string, TopicScoreParams>): void {
    const attesterSlashingTopicString = stringifyGossipTopic(config, {
      type: GossipType.attester_slashing,
      fork: ForkName.phase0,
    });
    const proposerSlashingTopicString = stringifyGossipTopic(config, {
      type: GossipType.proposer_slashing,
      fork: ForkName.phase0,
    });
    validateSlashingTopicScoreParams(topics[attesterSlashingTopicString]);
    validateSlashingTopicScoreParams(topics[proposerSlashingTopicString]);
  }

  function validateSlashingTopicScoreParams(params: TopicScoreParams): void {
    assertMessageRatePenaltiesDisabled(params);
    expect(params.topicWeight).to.be.equal(0.05);
    expect(params.timeInMeshWeight).closeTo(0.03333, TOLERANCE);
    expect(params.timeInMeshQuantum).to.be.equal(12 * 1000);
    expect(params.timeInMeshCap).to.be.equal(300.0);
    expect(params.firstMessageDeliveriesWeight).closeTo(36.81486, TOLERANCE);
    expect(params.firstMessageDeliveriesDecay).closeTo(0.998561, TOLERANCE);
    expect(params.firstMessageDeliveriesCap).closeTo(1.08652, TOLERANCE);
    expect(params.invalidMessageDeliveriesWeight).closeTo(-2200.0, TOLERANCE);
    expect(params.invalidMessageDeliveriesDecay).closeTo(0.99713, TOLERANCE);
  }

  function validateAggregateTopicParams(topics: Record<string, TopicScoreParams>, penaltiesActive: boolean): void {
    const topicString = stringifyGossipTopic(config, {
      type: GossipType.beacon_aggregate_and_proof,
      fork: ForkName.phase0,
    });
    const params = topics[topicString];

    expect(params.topicWeight).to.be.equal(0.5);
    expect(params.timeInMeshWeight).closeTo(0.03333, TOLERANCE);
    expect(params.timeInMeshQuantum).to.be.equal(12 * 1000);
    expect(params.timeInMeshCap).to.be.equal(300.0);
    expect(params.firstMessageDeliveriesWeight).closeTo(0.33509, TOLERANCE);
    expect(params.firstMessageDeliveriesDecay).closeTo(0.86596, TOLERANCE);
    expect(params.firstMessageDeliveriesCap).closeTo(119.3712, TOLERANCE);
    expect(params.invalidMessageDeliveriesWeight).closeTo(-220.0, TOLERANCE);
    expect(params.invalidMessageDeliveriesDecay).closeTo(0.99713, TOLERANCE);

    // Check message rate penalty params
    expect(params.meshMessageDeliveriesDecay).closeTo(0.930572, TOLERANCE);
    expect(params.meshMessageDeliveriesCap).closeTo(68.6255, TOLERANCE);
    expect(params.meshMessageDeliveriesActivation).to.be.equal(384 * 1000);
    expect(params.meshMessageDeliveriesWindow).to.be.equal(12 * 1000);
    expect(params.meshFailurePenaltyWeight).closeTo(-0.7474, TOLERANCE);
    expect(params.meshFailurePenaltyDecay).closeTo(0.93057, TOLERANCE);

    if (penaltiesActive) {
      expect(params.meshMessageDeliveriesWeight).closeTo(-0.7474, TOLERANCE);
      expect(params.meshMessageDeliveriesThreshold).closeTo(17.15638, TOLERANCE);
    } else {
      expect(params.meshMessageDeliveriesWeight).to.be.equal(0.0);
      expect(params.meshMessageDeliveriesThreshold).to.be.equal(0.0);
    }
  }

  function validateBlockTopicParams(topics: Record<string, TopicScoreParams>, penaltiesActive: boolean): void {
    const topicString = stringifyGossipTopic(config, {
      type: GossipType.beacon_block,
      fork: ForkName.phase0,
    });
    const params = topics[topicString];

    expect(params.topicWeight).to.be.equal(0.5);
    expect(params.timeInMeshWeight).closeTo(0.03333, TOLERANCE);
    expect(params.timeInMeshQuantum).to.be.equal(12 * 1000);
    expect(params.timeInMeshCap).to.be.equal(300.0);
    expect(params.firstMessageDeliveriesWeight).closeTo(1.14716, TOLERANCE);
    expect(params.firstMessageDeliveriesDecay).closeTo(0.99283, TOLERANCE);
    expect(params.firstMessageDeliveriesCap).closeTo(34.8687, TOLERANCE);
    expect(params.invalidMessageDeliveriesWeight).closeTo(-220.0, TOLERANCE);
    expect(params.invalidMessageDeliveriesDecay).closeTo(0.99713, TOLERANCE);

    // Check message rate penalty params
    expect(params.meshMessageDeliveriesDecay).closeTo(0.97163, TOLERANCE);
    expect(params.meshMessageDeliveriesCap).closeTo(2.0547574, TOLERANCE);
    expect(params.meshMessageDeliveriesActivation).to.be.equal(384 * 1000);
    expect(params.meshMessageDeliveriesWindow).to.be.equal(12 * 1000);
    expect(params.meshFailurePenaltyWeight).closeTo(-468.9689, TOLERANCE);
    expect(params.meshFailurePenaltyDecay).closeTo(0.97163, TOLERANCE);

    if (penaltiesActive) {
      expect(params.meshMessageDeliveriesWeight).closeTo(-468.9689, TOLERANCE);
      expect(params.meshMessageDeliveriesThreshold).closeTo(0.68491, TOLERANCE);
    } else {
      expect(params.meshMessageDeliveriesWeight).to.be.equal(0.0);
      expect(params.meshMessageDeliveriesThreshold).to.be.equal(0.0);
    }
  }

  function validateAllAttestationSubnetTopicParams(
    topics: Record<string, TopicScoreParams>,
    penaltiesActive: boolean
  ): void {
    for (let i = 0; i < ATTESTATION_SUBNET_COUNT; i++) {
      const topicString = stringifyGossipTopic(config, {
        type: GossipType.beacon_attestation,
        fork: ForkName.phase0,
        subnet: i,
      });
      validateAllAttestationSubnetTopicScoreParams(topics[topicString], penaltiesActive);
    }
  }

  function validateAllAttestationSubnetTopicScoreParams(params: TopicScoreParams, penaltiesActive: boolean): void {
    expect(params.topicWeight).to.be.equal(0.015625);
    expect(params.timeInMeshWeight).closeTo(0.03333, TOLERANCE);
    expect(params.timeInMeshQuantum).to.be.equal(12 * 1000);
    expect(params.timeInMeshCap).to.be.equal(300.0);
    expect(params.firstMessageDeliveriesWeight).closeTo(2.6807, TOLERANCE);
    expect(params.firstMessageDeliveriesDecay).closeTo(0.86596, TOLERANCE);
    expect(params.firstMessageDeliveriesCap).closeTo(14.9214, TOLERANCE);
    expect(params.invalidMessageDeliveriesWeight).closeTo(-7040.0, TOLERANCE);
    expect(params.invalidMessageDeliveriesDecay).closeTo(0.99713, TOLERANCE);

    // Check message rate penalty params
    expect(params.meshMessageDeliveriesDecay).closeTo(0.96466, TOLERANCE);
    expect(params.meshMessageDeliveriesCap).closeTo(69.88248, TOLERANCE);
    expect(params.meshMessageDeliveriesActivation).to.be.equal(204 * 1000);
    expect(params.meshMessageDeliveriesWindow).to.be.equal(12 * 1000);
    expect(params.meshFailurePenaltyWeight).closeTo(-369.0421, TOLERANCE);
    expect(params.meshFailurePenaltyDecay).closeTo(0.96466, TOLERANCE);

    if (penaltiesActive) {
      expect(params.meshMessageDeliveriesWeight).closeTo(-369.0421, TOLERANCE);
      expect(params.meshMessageDeliveriesThreshold).closeTo(4.367655, TOLERANCE);
    } else {
      expect(params.meshMessageDeliveriesWeight).to.be.equal(0.0);
      expect(params.meshMessageDeliveriesThreshold).to.be.equal(0.0);
    }
  }
});

function assertMessageRatePenaltiesDisabled(params: TopicScoreParams): void {
  expect(params.meshMessageDeliveriesWeight).to.be.equal(0.0);
  expect(params.meshMessageDeliveriesDecay).to.be.equal(0.0);
  expect(params.meshMessageDeliveriesThreshold).to.be.equal(0.0);
  expect(params.meshMessageDeliveriesCap).to.be.equal(0.0);
  expect(params.meshFailurePenaltyWeight).to.be.equal(0.0);
  expect(params.meshFailurePenaltyDecay).to.be.equal(0.0);
  expect(params.meshMessageDeliveriesActivation).to.be.equal(0);
  expect(params.meshMessageDeliveriesWindow).to.be.equal(0);
}
