/**
 * @module network/gossip
 */

import {ForkDigest, SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {AttestationSubnetRegExp, GossipEvent, GossipTopicRegExp} from "./constants";
import {assert} from "@chainsafe/lodestar-utils";
import {Message} from "libp2p-gossipsub/src/message";
import {utils} from "libp2p-pubsub";
import {IGossipEvents, ILodestarGossipMessage} from "./interface";
import {hash, toHexString} from "@chainsafe/ssz";
import {GossipEncoding} from "./encoding";
import {ILMDGHOST} from "../../chain";
import {IBeaconDb} from "../../db/api";
import {ITreeStateContext} from "../../db/api/beacon/stateContextCache";
import {processSlots} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/slot";

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
  assert.true(isAttestationSubnetTopic(topic), "Should be an attestation topic");
  const groups = topic.match(AttestationSubnetRegExp);
  const subnetStr = groups[4];
  return parseInt(subnetStr);
}

export function normalizeInRpcMessage(rawMessage: Message): ILodestarGossipMessage {
  const message: Message = utils.normalizeInRpcMessage(rawMessage);
  return {
    ...message,
    messageId: getMessageId(message)
  };
}

export function getMessageId(rawMessage: Message): string {
  return Buffer.from(hash(rawMessage.data)).toString("base64");
}

export async function getBlockStateContext(
  forkChoice: ILMDGHOST, db: IBeaconDb, block: SignedBeaconBlock
): Promise<ITreeStateContext|null> {
  const parentSummary =
      forkChoice.getBlockSummaryByBlockRoot(block.message.parentRoot as Uint8Array);
  if(!parentSummary) {
    return null;
  }
  const stateEpochCtx = await db.stateCache.get(parentSummary.stateRoot);
  if(!stateEpochCtx) return null;
  if (stateEpochCtx.state.slot < block.message.slot) {
    processSlots(stateEpochCtx.epochCtx, stateEpochCtx.state, block.message.slot);
  }
  return stateEpochCtx;
}
