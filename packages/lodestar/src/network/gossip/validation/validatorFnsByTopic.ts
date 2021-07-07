import {ATTESTATION_SUBNET_COUNT, ForkName, SYNC_COMMITTEE_SUBNET_COUNT} from "@chainsafe/lodestar-params";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {IForkDigestContext} from "../../../util/forkDigestContext";
import {stringifyGossipTopic} from "../topic";
import {DEFAULT_ENCODING} from "../constants";
import {GossipType, GossipValidatorFn, GossipTopic, ValidatorFnsByType} from "../interface";

/**
 * Associate a GossipValidator function to every possible topic that the node may subscribe too.
 *
 * GossipSub gets validator functions from the Map Eth2Gossipsub.topicValidators by message topicStr.
 * https://github.com/libp2p/js-libp2p-interfaces/blob/ff3bd10704a4c166ce63135747e3736915b0be8d/src/pubsub/index.js#L525
 *
 * Eth2Gossipsub MUST customize the validate() function above to ensure all validator functions are registered.
 *
 * Note: topics of the same type share validator functions
 * ```ts
 * '/eth2/0011aabb/beacon_attestation_0/ssz_snappy' -> ValidatorFnsByType[GossipType.beacon_attestation]
 * '/eth2/0011aabb/beacon_attestation_1/ssz_snappy' -> ValidatorFnsByType[GossipType.beacon_attestation]
 * ```
 */
export function createValidatorFnsByTopic(
  config: IChainForkConfig,
  forkDigestContext: IForkDigestContext,
  validatorFnsByType: ValidatorFnsByType
): Map<string, GossipValidatorFn> {
  const validatorFnsByTopic = new Map<string, GossipValidatorFn>();

  const encoding = DEFAULT_ENCODING;
  const allForkNames = Object.values(config.forks).map((fork) => fork.name);
  const allForksAfterPhase0 = allForkNames.filter((fork) => fork !== ForkName.phase0);

  const staticGossipTypes = [
    {type: GossipType.beacon_block, forks: allForkNames},
    {type: GossipType.beacon_aggregate_and_proof, forks: allForkNames},
    {type: GossipType.voluntary_exit, forks: allForkNames},
    {type: GossipType.proposer_slashing, forks: allForkNames},
    {type: GossipType.attester_slashing, forks: allForkNames},
    // Note: Calling .handleTopic() does not subscribe. Safe to do in any fork
    {type: GossipType.sync_committee_contribution_and_proof, forks: allForksAfterPhase0},
  ];

  for (const {type, forks} of staticGossipTypes) {
    for (const fork of forks) {
      const topic = {type, fork, encoding} as Required<GossipTopic>;
      const topicStr = stringifyGossipTopic(forkDigestContext, topic);
      validatorFnsByTopic.set(topicStr, validatorFnsByType[type]);
    }
  }

  for (const fork of allForkNames) {
    for (let subnet = 0; subnet < ATTESTATION_SUBNET_COUNT; subnet++) {
      const topic = {type: GossipType.beacon_attestation, fork, subnet, encoding};
      const topicStr = stringifyGossipTopic(forkDigestContext, topic);
      const topicValidatorFn = validatorFnsByType[GossipType.beacon_attestation];
      validatorFnsByTopic.set(topicStr, topicValidatorFn);
    }
  }

  for (const fork of allForksAfterPhase0) {
    for (let subnet = 0; subnet < SYNC_COMMITTEE_SUBNET_COUNT; subnet++) {
      const topic = {type: GossipType.sync_committee, fork, subnet, encoding};
      const topicStr = stringifyGossipTopic(forkDigestContext, topic);
      const topicValidatorFn = validatorFnsByType[GossipType.sync_committee];
      validatorFnsByTopic.set(topicStr, topicValidatorFn);
    }
  }

  return validatorFnsByTopic;
}
