/**
 * @module network/gossip
 */

import {IGossipMessage, IGossipMessageValidator} from "../interface";
import {AttesterSlashing} from "@chainsafe/eth2.0-types";
import {deserializeGossipMessage, getGossipTopic} from "../utils";
import {Gossip, GossipHandlerFn} from "../gossip";
import {GossipEvent} from "../constants";
import {serialize} from "@chainsafe/ssz";
//@ts-ignore
import promisify from "promisify-es6";

export function getIncomingAttesterSlashingHandler(validator: IGossipMessageValidator): GossipHandlerFn {
  return async function handleIncomingAttesterSlashing(this: Gossip, msg: IGossipMessage): Promise<void> {
    try {
      const attesterSlashing = deserializeGossipMessage<AttesterSlashing>(msg, this.config.types.AttesterSlashing);
      this.logger.verbose(
        "Received attester slashing"
      );
      if (await validator.isValidIncomingAttesterSlashing(attesterSlashing)) {
        this.emit(GossipEvent.ATTESTER_SLASHING, attesterSlashing);
      }
    } catch (e) {
      this.logger.warn("Incoming attester slashing error", e);
    }
  };
}

export async function publishAttesterSlashing(this: Gossip, attesterSlashing: AttesterSlashing): Promise<void> {
  await promisify(this.pubsub.publish.bind(this.pubsub))(
    getGossipTopic(GossipEvent.PROPOSER_SLASHING),
    serialize(attesterSlashing, this.config.types.AttesterSlashing)
  );
  this.logger.verbose(
    "Publishing attester slashing"
  );
}