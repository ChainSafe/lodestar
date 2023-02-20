import {ChainForkConfig} from "@lodestar/config";
import {GossipType, GossipTypeMap, GossipTopicTypeMap} from "../interface.js";

export type GetGossipAcceptMetadataFn = (
  config: ChainForkConfig,
  object: GossipTypeMap[GossipType],
  topic: GossipTopicTypeMap[GossipType]
) => Record<string, string | number>;
export type GetGossipAcceptMetadataFns = {
  [K in GossipType]: (
    config: ChainForkConfig,
    object: GossipTypeMap[K],
    topic: GossipTopicTypeMap[K]
  ) => Record<string, string | number>;
};
