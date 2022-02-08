import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {toHexString} from "@chainsafe/ssz";
import {GossipType, GossipTypeMap, GossipTopicTypeMap} from "../interface";

export type GetGossipAcceptMetadataFn = (
  config: IChainForkConfig,
  object: GossipTypeMap[GossipType],
  topic: GossipTopicTypeMap[GossipType]
) => Record<string, string | number>;
export type GetGossipAcceptMetadataFns = {
  [K in GossipType]: (
    config: IChainForkConfig,
    object: GossipTypeMap[K],
    topic: GossipTopicTypeMap[K]
  ) => Record<string, string | number>;
};

/**
 * Return succint but meaningful data about accepted gossip objects.
 * This data is logged at the debug level extremely frequently so it must be short.
 */
export const getGossipAcceptMetadataByType: GetGossipAcceptMetadataFns = {
  [GossipType.beacon_block]: (config, signedBlock) => ({
    slot: signedBlock.message.slot,
    root: toHexString(config.getForkTypes(signedBlock.message.slot).BeaconBlock.hashTreeRoot(signedBlock.message)),
  }),
  [GossipType.beacon_aggregate_and_proof]: (config, aggregateAndProof) => {
    const {data} = aggregateAndProof.message.aggregate;
    return {
      slot: data.slot,
      index: data.index,
    };
  },
  [GossipType.beacon_attestation]: (config, attestation, topic) => ({
    slot: attestation.data.slot,
    subnet: topic.subnet,
    index: attestation.data.index,
  }),
  [GossipType.voluntary_exit]: (config, voluntaryExit) => ({
    validatorIndex: voluntaryExit.message.validatorIndex,
  }),
  [GossipType.proposer_slashing]: (config, proposerSlashing) => ({
    proposerIndex: proposerSlashing.signedHeader1.message.proposerIndex,
  }),
  [GossipType.attester_slashing]: (config, attesterSlashing) => ({
    slot1: attesterSlashing.attestation1.data.slot,
    slot2: attesterSlashing.attestation2.data.slot,
  }),
  [GossipType.sync_committee_contribution_and_proof]: (config, contributionAndProof) => {
    const {contribution} = contributionAndProof.message;
    return {
      slot: contribution.slot,
      index: contribution.subcommitteeIndex,
    };
  },
  [GossipType.sync_committee]: (config, syncCommitteeSignature, topic) => ({
    slot: syncCommitteeSignature.slot,
    subnet: topic.subnet,
  }),
};
