/**
 * @module network/gossip
 */

import {phase0} from "@chainsafe/lodestar-types";
import {Gossip} from "../gossip";
import {getGossipTopic} from "../utils";
import {GossipEvent} from "../constants";
import {GossipObject} from "../interface";

export function handleIncomingBlock(this: Gossip, obj: GossipObject): void {
  try {
    const signedBlock = obj as phase0.SignedBeaconBlock;
    this.logger.verbose("Incoming gossip block", {slot: signedBlock.message.slot});
    this.emit(GossipEvent.BLOCK, signedBlock);
  } catch (e) {
    this.logger.warn("Incoming block error", e);
  }
}

export async function publishBlock(this: Gossip, signedBlock: phase0.SignedBeaconBlock): Promise<void> {
  const forkDigestValue = this.getForkDigest(signedBlock.message.slot);

  await this.pubsub.publish(
    getGossipTopic(GossipEvent.BLOCK, forkDigestValue),
    Buffer.from(this.config.types.phase0.SignedBeaconBlock.serialize(signedBlock))
  );

  this.logger.verbose("Publishing block", {block: signedBlock.message.slot});
}
