/**
 * @module network/gossip
 */

import {Attestation, ForkDigest} from "@chainsafe/lodestar-types";
import {ATTESTATION_SUBNET_COUNT} from "../../constants";
import {GossipEvent, AttestationSubnetRegExp, GossipTopicRegExp} from "./constants";
import {CommitteeIndex} from "@chainsafe/lodestar-types/lib";
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

export function getAttestationSubnetTopic(
  attestation: Attestation,
  forkDigestValue: ForkDigest,
  encoding = GossipEncoding.SSZ_SNAPPY): string {
  return getGossipTopic(
    GossipEvent.ATTESTATION_SUBNET,
    forkDigestValue,
    encoding,
    new Map([["subnet", getAttestationSubnet(attestation)]])
  );
}

export function getAttestationSubnet(attestation: Attestation): string {
  return getCommitteeIndexSubnet(attestation.data.index);
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

export function getCommitteeIndexSubnet(committeeIndex: CommitteeIndex): string {
  return String(committeeIndex % ATTESTATION_SUBNET_COUNT);
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
  assert.true(isAttestationSubnetTopic(topic), "should be an attestation topic");
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