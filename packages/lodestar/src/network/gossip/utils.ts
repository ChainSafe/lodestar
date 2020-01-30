/**
 * @module network/gossip
 */

import {ATTESTATION_SUBNET_COUNT, GOSSIP_MAX_SIZE} from "../../constants";
import {Attestation} from "@chainsafe/eth2.0-types";
import {IGossipMessage} from "./interface";
import assert from "assert";
import {Type} from "@chainsafe/ssz";
import {GossipEvent} from "./constants";

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

export function deserializeGossipMessage<T>(type: Type<T>, msg: IGossipMessage): T {
  assert(msg.data.length <= GOSSIP_MAX_SIZE, `Message exceeds size limit of ${GOSSIP_MAX_SIZE} bytes`);
  return type.deserialize(msg.data);
}
