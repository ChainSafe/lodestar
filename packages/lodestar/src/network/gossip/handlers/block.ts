/**
 * @module network/gossip
 */

import {IGossipMessage} from "../interface";
import {BeaconBlock} from "@chainsafe/eth2.0-types";
import {Gossip} from "../gossip";
import {handleGossipMessage} from "../utils";
import {GossipEvent} from "../constants";

export function handleIncomingBlock(this: Gossip, msg: IGossipMessage): void {
  try {
    const block = handleGossipMessage<BeaconBlock>(msg, this.config.types.BeaconBlock);
    this.logger.verbose(`Incoming block at slot: ${block.slot}`);
    this.emit(GossipEvent.BLOCK, block);
  } catch (e) {
    this.logger.warn("Incoming block error", e);
  }
}