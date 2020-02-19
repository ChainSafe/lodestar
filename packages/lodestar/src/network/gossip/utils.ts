/**
 * @module network/gossip
 */

import {ATTESTATION_SUBNET_COUNT} from "../../constants";
import {Attestation} from "@chainsafe/eth2.0-types";
import {GossipEvent, AttestationSubnetRegExp} from "./constants";
import assert from "assert";

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
  return String(attestation.data.index % ATTESTATION_SUBNET_COUNT);
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
