/* eslint-disable @typescript-eslint/naming-convention */
import {allForks} from "@chainsafe/lodestar-beacon-state-transition";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {ATTESTATION_SUBNET_COUNT, SLOTS_PER_EPOCH, TARGET_AGGREGATORS_PER_COMMITTEE} from "@chainsafe/lodestar-params";
import {Context, ILogger} from "@chainsafe/lodestar-utils";
import {PeerScoreThresholds} from "libp2p-gossipsub/src/score";
import {defaultTopicScoreParams, PeerScoreParams, TopicScoreParams} from "libp2p-gossipsub/src/score/peer-score-params";
import {IBeaconChain, IBeaconClock} from "../../chain";
import {IForkDigestContext} from "../../util/forkDigestContext";
import {FORK_EPOCH_LOOKAHEAD, getCurrentAndNextFork} from "../forks";
import {IGossipsubModules} from "./gossipsub";
import {GossipType} from "./interface";
import {stringifyGossipTopic} from "./topic";

export const GOSSIP_D = 8;
export const GOSSIP_D_LOW = 6;
export const GOSSIP_D_HIGH = 12;

const MAX_IN_MESH_SCORE = 10.0;
const MAX_FIRST_MESSAGE_DELIVERIES_SCORE = 40.0;
const BEACON_BLOCK_WEIGHT = 0.5;
const BEACON_AGGREGATE_PROOF_WEIGHT = 0.5;
const VOLUNTARY_EXIT_WEIGHT = 0.05;
const PROPOSER_SLASHING_WEIGHT = 0.05;
const ATTESTER_SLASHING_WEIGHT = 0.05;

const beaconAttestationSubnetWeight = 1 / ATTESTATION_SUBNET_COUNT;
const maxPositiveScore =
  (MAX_IN_MESH_SCORE + MAX_FIRST_MESSAGE_DELIVERIES_SCORE) *
  (BEACON_BLOCK_WEIGHT +
    +BEACON_AGGREGATE_PROOF_WEIGHT +
    beaconAttestationSubnetWeight * ATTESTATION_SUBNET_COUNT +
    VOLUNTARY_EXIT_WEIGHT +
    PROPOSER_SLASHING_WEIGHT +
    ATTESTER_SLASHING_WEIGHT);

/**
 * The following params is implemented by Lighthouse.
 */
export const gossipScoreThresholds: PeerScoreThresholds = {
  gossipThreshold: -4000,
  publishThreshold: -8000,
  graylistThreshold: -16000,
  acceptPXThreshold: 100,
  opportunisticGraftThreshold: 5,
};

type MeshMessageInfo = {
  decaySlots: number;
  capFactor: number;
  activationWindow: number;
  currentSlot: number;
};

export class GossipPeerScoreParamsBuilder {
  private readonly config: IChainForkConfig;
  private readonly forkDigestContext: IForkDigestContext;
  private readonly logger: ILogger;
  private readonly clock: IBeaconClock;
  private readonly chain: IBeaconChain;

  private decayIntervalMs: number;
  private decayToZero: number;
  private epochDurationMs: number;
  private slotDurationMs: number;

  constructor(modules: IGossipsubModules) {
    const {config, forkDigestContext, logger, clock, chain} = modules;
    this.config = config;
    this.forkDigestContext = forkDigestContext;
    this.logger = logger;
    this.clock = clock;
    this.chain = chain;
    this.decayIntervalMs = this.config.SECONDS_PER_SLOT * 1000;
    this.decayToZero = 0.01;
    this.epochDurationMs = this.config.SECONDS_PER_SLOT * SLOTS_PER_EPOCH * 1000;
    this.slotDurationMs = this.config.SECONDS_PER_SLOT * 1000;
  }

  /**
   * Explanation of each param https://github.com/libp2p/specs/blob/master/pubsub/gossipsub/gossipsub-v1.1.md#peer-scoring
   */
  getGossipPeerScoreParams(): Partial<PeerScoreParams> {
    const behaviourPenaltyDecay = this.scoreParameterDecay(this.epochDurationMs * 10);
    const behaviourPenaltyThreshold = 6;
    const targetValue = decayConvergence(behaviourPenaltyDecay, 10 / SLOTS_PER_EPOCH) - behaviourPenaltyThreshold;
    const topicScoreCap = maxPositiveScore * 0.5;

    const params = {
      topics: this.getAllTopicsScoreParams(),
      decayInterval: this.decayIntervalMs,
      decayToZero: this.decayToZero,
      // time to remember counters for a disconnected peer, should be in ms
      retainScore: this.epochDurationMs * 100,
      appSpecificWeight: 1,
      IPColocationFactorThreshold: 3,
      // js-gossipsub doesn't have behaviourPenaltiesThreshold
      behaviourPenaltyDecay,
      behaviourPenaltyWeight: gossipScoreThresholds.gossipThreshold / (targetValue * targetValue),
      topicScoreCap,
      IPColocationFactorWeight: -1 * topicScoreCap,
    };
    this.logger.verbose("Gossip Peer Score Params", (params as unknown) as Context);
    return params;
  }

  private getAllTopicsScoreParams(): Record<string, TopicScoreParams> {
    const epoch = this.clock.currentEpoch;
    const {currentFork, nextFork} = getCurrentAndNextFork(this.config, epoch - FORK_EPOCH_LOOKAHEAD - 1);
    const topicsParams: Record<string, TopicScoreParams> = {};
    const forks = nextFork ? [currentFork, nextFork] : [currentFork];
    const beaconAttestationSubnetWeight = 1 / ATTESTATION_SUBNET_COUNT;
    for (const fork of forks.map((fork) => fork.name)) {
      //first all fixed topics
      topicsParams[
        stringifyGossipTopic(this.forkDigestContext, {
          type: GossipType.voluntary_exit,
          fork,
        })
      ] = this.getTopicScoreParams(VOLUNTARY_EXIT_WEIGHT, 4 / SLOTS_PER_EPOCH, this.epochDurationMs * 100);
      topicsParams[
        stringifyGossipTopic(this.forkDigestContext, {
          type: GossipType.attester_slashing,
          fork,
        })
      ] = this.getTopicScoreParams(ATTESTER_SLASHING_WEIGHT, 1 / 5 / SLOTS_PER_EPOCH, this.epochDurationMs * 100);
      topicsParams[
        stringifyGossipTopic(this.forkDigestContext, {
          type: GossipType.proposer_slashing,
          fork,
        })
      ] = this.getTopicScoreParams(PROPOSER_SLASHING_WEIGHT, 1 / 5 / SLOTS_PER_EPOCH, this.epochDurationMs * 100);

      // other topics
      topicsParams[
        stringifyGossipTopic(this.forkDigestContext, {
          type: GossipType.beacon_block,
          fork,
        })
      ] = this.getTopicScoreParams(BEACON_BLOCK_WEIGHT, 1, this.epochDurationMs * 20, {
        decaySlots: SLOTS_PER_EPOCH * 5,
        capFactor: 3,
        activationWindow: this.epochDurationMs,
        currentSlot: this.clock.currentSlot,
      });

      const activeValidatorCount = this.chain.getHeadState().currentShuffling.activeIndices.length;
      const {aggregatorsPerslot, committeesPerSlot} = expectedAggregatorCountPerSlot(activeValidatorCount);
      const multipleBurstsPerSubnetPerEpoch = committeesPerSlot >= (2 * ATTESTATION_SUBNET_COUNT) / SLOTS_PER_EPOCH;
      topicsParams[
        stringifyGossipTopic(this.forkDigestContext, {
          type: GossipType.beacon_aggregate_and_proof,
          fork,
        })
      ] = this.getTopicScoreParams(BEACON_AGGREGATE_PROOF_WEIGHT, aggregatorsPerslot, this.epochDurationMs, {
        decaySlots: SLOTS_PER_EPOCH * 2,
        capFactor: 4,
        activationWindow: this.epochDurationMs,
        currentSlot: this.clock.currentSlot,
      });

      for (let subnet = 0; subnet < ATTESTATION_SUBNET_COUNT; subnet++) {
        const topicStr = stringifyGossipTopic(this.forkDigestContext, {
          type: GossipType.beacon_attestation,
          fork,
          subnet,
        });
        topicsParams[topicStr] = this.getTopicScoreParams(
          beaconAttestationSubnetWeight,
          activeValidatorCount / ATTESTATION_SUBNET_COUNT / SLOTS_PER_EPOCH,
          multipleBurstsPerSubnetPerEpoch ? this.epochDurationMs : this.epochDurationMs * 4,
          {
            decaySlots: multipleBurstsPerSubnetPerEpoch ? SLOTS_PER_EPOCH * 4 : SLOTS_PER_EPOCH * 16,
            capFactor: 16,
            activationWindow: multipleBurstsPerSubnetPerEpoch
              ? this.slotDurationMs * (SLOTS_PER_EPOCH / 2 + 1)
              : this.epochDurationMs,
            currentSlot: this.clock.currentSlot,
          }
        );
      }
    }
    return topicsParams;
  }

  private getTopicScoreParams(
    topicWeight: number,
    expectedMessageRate: number,
    firstMessageDecayTime: number,
    meshMessageInfo?: MeshMessageInfo
  ): TopicScoreParams {
    const params = {...defaultTopicScoreParams};

    params.topicWeight = topicWeight;

    params.timeInMeshQuantum = this.config.SECONDS_PER_SLOT;
    params.timeInMeshCap = 3600 / params.timeInMeshQuantum;
    params.timeInMeshWeight = 10 / params.timeInMeshCap;

    params.firstMessageDeliveriesDecay = this.scoreParameterDecay(firstMessageDecayTime);
    params.firstMessageDeliveriesCap = decayConvergence(
      params.firstMessageDeliveriesDecay,
      (2 * expectedMessageRate) / GOSSIP_D
    );
    params.firstMessageDeliveriesWeight = 40 / params.firstMessageDeliveriesCap;

    if (meshMessageInfo) {
      const {decaySlots, capFactor, activationWindow, currentSlot} = meshMessageInfo;
      const decayTimeMs = this.config.SECONDS_PER_SLOT * decaySlots * 1000;
      params.meshMessageDeliveriesDecay = this.scoreParameterDecay(decayTimeMs);
      params.meshMessageDeliveriesThreshold = threshold(params.meshMessageDeliveriesDecay, expectedMessageRate / 50);
      params.meshMessageDeliveriesCap = Math.max(capFactor * params.meshMessageDeliveriesThreshold, 2);
      params.meshMessageDeliveriesActivation = activationWindow;
      params.meshMessageDeliveriesWindow = 2 * 1000; // 2s
      params.meshFailurePenaltyDecay = params.meshMessageDeliveriesDecay;
      params.meshMessageDeliveriesWeight =
        (-1 * maxPositiveScore) / (params.topicWeight * Math.pow(params.meshMessageDeliveriesThreshold, 2));
      params.meshFailurePenaltyWeight = params.meshMessageDeliveriesWeight;
      if (decaySlots >= currentSlot) {
        params.meshMessageDeliveriesThreshold = 0;
        params.meshMessageDeliveriesWeight = 0;
      }
    } else {
      params.meshMessageDeliveriesWeight = 0;
      params.meshMessageDeliveriesThreshold = 0;
      params.meshMessageDeliveriesDecay = 0;
      params.meshMessageDeliveriesCap = 0;
      params.meshMessageDeliveriesWindow = 0;
      params.meshMessageDeliveriesActivation = 0;
      params.meshFailurePenaltyDecay = 0;
      params.meshFailurePenaltyWeight = 0;
    }
    params.invalidMessageDeliveriesWeight = (-1 * maxPositiveScore) / params.topicWeight;
    params.invalidMessageDeliveriesDecay = this.scoreParameterDecay(this.epochDurationMs * 50);
    return params;
  }

  private scoreParameterDecay(decayTimeMs: number): number {
    return scoreParameterDecayWithBase(decayTimeMs, this.decayIntervalMs, this.decayToZero);
  }
}

function expectedAggregatorCountPerSlot(
  activeValidatorCount: number
): {aggregatorsPerslot: number; committeesPerSlot: number} {
  const committeesPerSlot = allForks.computeCommitteeCount(activeValidatorCount);
  const committeesPerEpoch = committeesPerSlot * SLOTS_PER_EPOCH;
  const smallerCommitteeSize = Math.floor(activeValidatorCount / committeesPerEpoch);
  const largerCommiteeeSize = smallerCommitteeSize + 1;
  const largeCommitteesPerEpoch = activeValidatorCount - smallerCommitteeSize * committeesPerEpoch;
  const smallCommiteesPerEpoch = committeesPerEpoch - largeCommitteesPerEpoch;
  const moduloSmaller = Math.max(1, Math.floor(smallerCommitteeSize / TARGET_AGGREGATORS_PER_COMMITTEE));
  const moduloLarger = Math.max(1, Math.floor((smallerCommitteeSize + 1) / TARGET_AGGREGATORS_PER_COMMITTEE));
  const smallCommitteeAggregatorPerEpoch = Math.floor((smallerCommitteeSize / moduloSmaller) * smallCommiteesPerEpoch);
  const largeCommitteeAggregatorPerEpoch = Math.floor((largerCommiteeeSize / moduloLarger) * largeCommitteesPerEpoch);

  return {
    aggregatorsPerslot: Math.floor(
      (smallCommitteeAggregatorPerEpoch + largeCommitteeAggregatorPerEpoch) / SLOTS_PER_EPOCH
    ),
    committeesPerSlot,
  };
}

function scoreParameterDecayWithBase(decayTimeMs: number, decayIntervalMs: number, decayToZero: number): number {
  const ticks = decayTimeMs / decayIntervalMs;
  return Math.pow(decayToZero, 1 / ticks);
}

function threshold(decay: number, rate: number): number {
  return decayConvergence(decay, rate) * decay;
}

function decayConvergence(decay: number, rate: number): number {
  return rate / (1 - decay);
}
