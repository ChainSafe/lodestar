import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {GossipType, GossipTypeMap, GossipTopicTypeMap} from "../interface.js";

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
