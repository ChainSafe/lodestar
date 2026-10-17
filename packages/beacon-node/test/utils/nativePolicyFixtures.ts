import {mkdirSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {privateKeyFromRaw} from "@libp2p/crypto/keys";
import {defaultTopicScoreParams} from "@libp2p/gossipsub/score";
import {createBeaconConfig} from "@lodestar/config";
import {ACTIVE_PRESET, ATTESTATION_SUBNET_COUNT, SLOTS_PER_EPOCH, TARGET_COMMITTEE_SIZE} from "@lodestar/params";
import {kinds} from "../../src/network/core/native/config.js";
import {computeGossipPeerScoreParamsByKind, gossipScoreThresholds} from "../../src/network/gossip/scoringParameters.js";
import {computeNodeIdFromPrivateKey} from "../../src/network/subnets/interface.js";
import {computeSubscribedSubnet} from "../../src/network/subnets/util.js";
import {CustodyConfig} from "../../src/util/dataColumns.js";

// Run with node --import tsx, LODESTAR_PRESET=mainnet or minimal, and the lodestar-z testdata directory as argv[2].
const destination = process.argv[2];
if (!destination) throw Error("Expected the lodestar-z policy fixture directory");
const threshold = 2 * ATTESTATION_SUBNET_COUNT * TARGET_COMMITTEE_SIZE;
const cases = [
  [1, 12000],
  [16, 6000],
  [threshold - 1, 12000],
  [threshold, 12000],
  [threshold + 1, 12000],
  [1_000_000, 24000],
  [3_000_000, 12000],
].map(([validators, slotMs]) => {
  const config = createBeaconConfig({SLOT_DURATION_MS: slotMs}, new Uint8Array(32));
  const score = computeGossipPeerScoreParamsByKind(config, validators);
  return {
    validators,
    slot_ms: slotMs,
    retained_score_ms: score.retainScore,
    global: {
      ip_colocation_weight: score.IPColocationFactorWeight,
      ip_colocation_threshold: score.IPColocationFactorThreshold,
      behaviour_weight: score.behaviourPenaltyWeight,
      behaviour_threshold: score.behaviourPenaltyThreshold,
      behaviour_decay: score.behaviourPenaltyDecay,
      topic_cap: score.topicScoreCap,
      decay_interval_ms: score.decayInterval,
      decay_to_zero: score.decayToZero,
      gossip_threshold: gossipScoreThresholds.gossipThreshold,
      publish_threshold: gossipScoreThresholds.publishThreshold,
      graylist_threshold: gossipScoreThresholds.graylistThreshold,
      opportunistic_graft_threshold: gossipScoreThresholds.opportunisticGraftThreshold,
    },
    topics: kinds.map((kind) => {
      const params = score.topics[kind] ?? {...defaultTopicScoreParams, topicWeight: 0, meshDeliveryStartSlot: 0};
      return {
        mesh_delivery_start_slot: params.meshDeliveryStartSlot,
        params: {
          weight: params.topicWeight,
          time_in_mesh_weight: params.timeInMeshWeight,
          time_in_mesh_cap: params.timeInMeshCap,
          time_in_mesh_quantum_ms: params.timeInMeshQuantum,
          first_delivery_weight: params.firstMessageDeliveriesWeight,
          first_delivery_cap: params.firstMessageDeliveriesCap,
          first_delivery_decay: params.firstMessageDeliveriesDecay,
          mesh_delivery_weight: params.meshMessageDeliveriesWeight,
          mesh_delivery_threshold: params.meshMessageDeliveriesThreshold,
          mesh_delivery_cap: params.meshMessageDeliveriesCap,
          mesh_delivery_decay: params.meshMessageDeliveriesDecay,
          mesh_delivery_activation_ms: params.meshMessageDeliveriesActivation,
          mesh_delivery_window_ms: params.meshMessageDeliveriesWindow,
          mesh_failure_weight: params.meshFailurePenaltyWeight,
          mesh_failure_decay: params.meshFailurePenaltyDecay,
          invalid_weight: params.invalidMessageDeliveriesWeight,
          invalid_decay: params.invalidMessageDeliveriesDecay,
        },
      };
    }),
    slots_per_epoch: SLOTS_PER_EPOCH,
  };
});
mkdirSync(destination, {recursive: true});
writeFileSync(join(destination, `application_scores_${ACTIVE_PRESET}.json`), `${JSON.stringify(cases, null, 2)}\n`);

const subnetMask = (indices: number[]): string =>
  indices.reduce((mask, index) => mask | (1n << BigInt(index)), 0n).toString(16);
const subscriptionConfig = createBeaconConfig({}, new Uint8Array(32));
const subnetCases = [1, 2, 255].map((secret) => {
  const bytes = new Uint8Array(32);
  bytes[31] = secret;
  const nodeId = computeNodeIdFromPrivateKey(privateKeyFromRaw(bytes));
  const offset = nodeId[31];
  return {
    secret,
    node_id: [...nodeId],
    epochs: [0, 255 - offset, 256 - offset, 256, 1024].map((epoch) => ({
      epoch,
      subnets: computeSubscribedSubnet(subscriptionConfig, nodeId, epoch),
    })),
    custody: [1, subscriptionConfig.NUMBER_OF_CUSTODY_GROUPS].map((count) => {
      const custody = new CustodyConfig({config: subscriptionConfig, nodeId, initialCustodyGroupCount: count});
      return {count, groups: subnetMask(custody.sampleGroups), subnets: subnetMask(custody.sampledSubnets)};
    }),
  };
});
writeFileSync(
  join(destination, `application_subnets_${ACTIVE_PRESET}.json`),
  `${JSON.stringify(subnetCases, null, 2)}\n`
);
