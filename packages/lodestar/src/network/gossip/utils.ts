/**
 * @module network/gossip
 */

import assert from "assert";
import {Attestation} from "@chainsafe/lodestar-types";
import {ATTESTATION_SUBNET_COUNT} from "../../constants";
import {GossipEvent, AttestationSubnetRegExp} from "./constants";
import {CommitteeIndex} from "@chainsafe/lodestar-types/lib";
import {IGossipMessage} from "libp2p-gossipsub";
import {utils} from "libp2p-pubsub";
import {ILodestarGossipMessage} from "./interface";
import {hash} from "@chainsafe/ssz";

export function getGossipTopic(event: GossipEvent, encoding = "ssz", params: Map<string, string> = new Map()): string {
  let topic = `${event}/${encoding}`;
  params.forEach((value, key) => {
    topic = topic.replace(`{${key}}`, value);
  });
  return topic;
}

export function getAttestationSubnetTopic(attestation: Attestation, encoding = "ssz"): string {
  return getGossipTopic(
    GossipEvent.ATTESTATION_SUBNET,
    encoding,
    new Map([["subnet", getAttestationSubnet(attestation)]])
  );
}

export function getAttestationSubnet(attestation: Attestation): string {
  return getCommitteeIndexSubnet(attestation.data.index);
}

export function getCommitteeIndexSubnet(committeeIndex: CommitteeIndex): string {
  return String(committeeIndex % ATTESTATION_SUBNET_COUNT);
}

export function isAttestationSubnetTopic(topic: string): boolean {
  return AttestationSubnetRegExp.test(topic);
}

export function getSubnetFromAttestationSubnetTopic(topic: string): number {
  assert(isAttestationSubnetTopic(topic), "should be an attestation topic");
  const groups = topic.match(AttestationSubnetRegExp);
  const subnetStr = groups[2];
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