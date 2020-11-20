/**
 * @module network/gossip
 */

import {toHexString} from "@chainsafe/ssz";
import {ForkDigest} from "@chainsafe/lodestar-types";
import {assert} from "@chainsafe/lodestar-utils";

import {AttestationSubnetRegExp, GossipEvent, GossipTopicRegExp} from "./constants";
import {IGossipEvents} from "./interface";
import {GossipEncoding} from "./encoding";

export function getGossipTopic(
  event: GossipEvent,
  forkDigestValue: ForkDigest,
  encoding = GossipEncoding.SSZ_SNAPPY,
  params: Map<string, string> = new Map()
): string {
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
  const topicName = groups && groups[3];
  if (!topicName) throw Error(`Bad gossip topic format: ${topic}`);
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
  assert.true(isAttestationSubnetTopic(topic), "Should be an attestation topic");
  const groups = topic.match(AttestationSubnetRegExp);
  const subnetStr = groups && groups[4];
  if (!subnetStr) throw Error(`Bad attestation topic format: ${topic}`);
  return parseInt(subnetStr);
}

export function msgIdToString(msgId: Uint8Array): string {
  return Buffer.from(msgId).toString("base64");
}
