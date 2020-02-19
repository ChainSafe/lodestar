/**
 * @module network/gossip
 */

import {SignedBeaconBlock} from "@chainsafe/eth2.0-types";
import {Gossip} from "../gossip";
import {getGossipTopic} from "../utils";
import {GossipEvent} from "../constants";
import {serialize} from "@chainsafe/ssz";
import {GossipObject} from "../interface";

export async function handleIncomingBlock(this: Gossip, obj: GossipObject): Promise<void> {
  try {
    const signedBlock = obj as SignedBeaconBlock;
    this.logger.verbose(`Incoming block at slot: ${signedBlock.message.slot}`);
    this.emit(GossipEvent.BLOCK, signedBlock);
  } catch (e) {
    this.logger.warn("Incoming block error", e);
  }
}

export async function publishBlock(this: Gossip, signedBlock: SignedBeaconBlock): Promise<void> {
  await this.pubsub.publish(
    getGossipTopic(GossipEvent.BLOCK), serialize(this.config.types.SignedBeaconBlock, signedBlock)
  );
  this.logger.verbose(`Publishing block at slot: ${signedBlock.message.slot}`);
}
