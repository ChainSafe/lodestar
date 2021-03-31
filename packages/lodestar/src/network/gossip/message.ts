import {ERR_TOPIC_VALIDATOR_REJECT} from "libp2p-gossipsub/src/constants";
import {GossipValidationError} from "./errors";
import {decodeMessageData} from "./encoding";
import {getGossipSSZDeserializer} from "./topic";
import {IGossipMessage, GossipTypeMap, GossipTopicMap, GossipType, GossipTopic, GossipEncoding} from "./interface";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

/**
 * Mutates the `IGossipMessage` `message` so `parseGossipMsg()` can use it
 */
export function prepareGossipMsg(message: IGossipMessage, gossipTopic: GossipTopic, config: IBeaconConfig): void {
  // get GossipTopic and GossipObject, set on IGossipMessage
  const messageData = decodeMessageData(gossipTopic.encoding as GossipEncoding, message.data);
  const gossipObject = getGossipSSZDeserializer(config, gossipTopic)(messageData);
  // Lodestar ObjectValidatorFns rely on these properties being set
  message.gossipObject = gossipObject;
  message.gossipTopic = gossipTopic;
}

export function parseGossipMsg<K extends GossipType>(
  msg: IGossipMessage
): {gossipTopic: GossipTopicMap[K]; gossipObject: GossipTypeMap[K]} {
  const gossipTopic = msg.gossipTopic as GossipTopicMap[K];
  const gossipObject = msg.gossipObject as GossipTypeMap[K];
  if (gossipTopic == null || gossipObject == null) {
    throw new GossipValidationError(ERR_TOPIC_VALIDATOR_REJECT);
  }
  return {gossipTopic, gossipObject};
}
