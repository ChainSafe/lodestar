/**
 * @module network/gossip
 */

import {ForkDigest} from "@chainsafe/lodestar-types";
import {GossipEvent, AttestationSubnetRegExp, GossipTopicRegExp} from "./constants";
import {assert} from "@chainsafe/lodestar-utils";
import {IGossipMessage} from "libp2p-gossipsub";
import {utils} from "libp2p-pubsub";
import {ILodestarGossipMessage, IGossipEvents} from "./interface";
import {hash, toHexString} from "@chainsafe/ssz";
import {GossipEncoding} from "./encoding";

export function getGossipTopic(
  event: GossipEvent,
  forkDigestValue: ForkDigest,
  encoding = GossipEncoding.SSZ_SNAPPY,
  params: Map<string, string> = new Map()): string {
  const forkDigestHash = toHexString(forkDigestValue).toLowerCase().substring(2);
  let topic = `/eth2/${forkDigestHash}/${event}/${encoding}`;
  params.forEach((value, key) => {
    topic = topic.replace(`{${key}}`, value);
  });
  return topic;
}


export function mapGossipEvent(event: keyof IGossipEvents | string): GossipEvent {
  if (isAttestationSubnetEvent(event)) {
    return GossipEvent.ATTESTATION_SUBNET;
  }
  return event as GossipEvent;
}

export function topicToGossipEvent(topic: string): GossipEvent {
  const groups = topic.match(GossipTopicRegExp);
  const topicName = groups[3] as keyof typeof GossipEvent;
  return topicName as GossipEvent;
}


export function getAttestationSubnetEvent(subnet: number): string {
  return GossipEvent.ATTESTATION_SUBNET + "_" + subnet;
}

export function isAttestationSubnetEvent(event: keyof IGossipEvents | string): boolean {
  return event.toString().startsWith(GossipEvent.ATTESTATION_SUBNET);
}

export function isAttestationSubnetTopic(topic: string): boolean {
  return AttestationSubnetRegExp.test(topic);
}

export function getSubnetFromAttestationSubnetTopic(topic: string): number {
  assert(isAttestationSubnetTopic(topic), "should be an attestation topic");
  const groups = topic.match(AttestationSubnetRegExp);
  const subnetStr = groups[4];
  return parseInt(subnetStr);
}

export function normalizeInRpcMessage(rawMessage: IGossipMessage): ILodestarGossipMessage {
  const message: IGossipMessage = utils.normalizeInRpcMessage(rawMessage);
  return {
    ...message,
    messageId: getMessageId(message)
  };
}

export function getMessageId(rawMessage: IGossipMessage): string {
  return Buffer.from(hash(rawMessage.data)).toString("base64");
}
