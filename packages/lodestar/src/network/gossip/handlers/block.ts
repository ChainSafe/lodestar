/**
 * @module network/gossip
 */

import {IGossipMessage, IGossipMessageValidator} from "../interface";
import {BeaconBlock} from "@chainsafe/eth2.0-types";
import {Gossip, GossipHandlerFn} from "../gossip";
import {deserializeGossipMessage, getGossipTopic} from "../utils";
import {GossipEvent} from "../constants";
import {serialize} from "@chainsafe/ssz";
//@ts-ignore
import promisify from "promisify-es6";

export function getIncomingBlockHandler(validator: IGossipMessageValidator): GossipHandlerFn {
  return async function handleIncomingBlock(this: Gossip, msg: IGossipMessage): Promise<void> {
    try {
      const block = deserializeGossipMessage<BeaconBlock>(msg, this.config.types.BeaconBlock);
      this.logger.verbose(`Incoming block at slot: ${block.slot}`);
      if (await validator.isValidIncomingBlock(block)) {
        this.emit(GossipEvent.BLOCK, block);
      }
    } catch (e) {
      this.logger.warn("Incoming block error", e);
    }
  };
}

export async function publishBlock(this: Gossip, block: BeaconBlock): Promise<void> {
  await promisify(this.pubsub.publish.bind(this.pubsub))(
    getGossipTopic(GossipEvent.BLOCK), serialize(block, this.config.types.BeaconBlock)
  );
  this.logger.verbose(`Publishing block at slot: ${block.slot}`);
}