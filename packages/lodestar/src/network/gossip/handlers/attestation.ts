/**
 * @module network/gossip
 */

import {Gossip} from "../gossip";
import {IGossipMessage} from "../interface";
import {deserializeGossipMessage, getAttestationSubnet, getAttestationSubnetTopic, getGossipTopic} from "../utils";
import {Attestation} from "@chainsafe/eth2.0-types";
import {toHex} from "@chainsafe/eth2.0-utils";
import {GossipEvent} from "../constants";
import {hashTreeRoot, serialize} from "@chainsafe/ssz";
//@ts-ignore
import promisify from "promisify-es6";

export function handleIncomingAttestation(this: Gossip, msg: IGossipMessage): void {
  try {
    const attestation = deserializeGossipMessage<Attestation>(msg, this.config.types.Attestation);
    this.logger.verbose(
      `Received attestation for block ${toHex(attestation.data.beaconBlockRoot)}`
        +` (${attestation.data.source.epoch}, ${attestation.data.target.epoch})`
    );
    this.emit(GossipEvent.ATTESTATION, attestation);
  } catch (e) {
    this.logger.warn("Incoming attestation error", e);
  }
}

export type handleCommitteeAttestationFn = (this: Gossip, msg: IGossipMessage) => void;

export function getCommitteeAttestationHandler(subnet: number): handleCommitteeAttestationFn {
  return function handleIncomingCommitteeAttestation(this: Gossip, msg: IGossipMessage): void {
    try {
      const attestation = deserializeGossipMessage<Attestation>(msg, this.config.types.Attestation);
      this.logger.verbose(
        `Received committee attestation for block ${toHex(attestation.data.beaconBlockRoot)}`
          +`subnet: ${subnet}, (${attestation.data.source.epoch}, ${attestation.data.target.epoch})`
      );
      this.emit(GossipEvent.ATTESTATION_SUBNET, {attestation, subnet});
    } catch (e) {
      this.logger.warn("Incoming committee attestation error", e);
    }
  };
}

export async function publishCommiteeAttestation(this: Gossip, attestation: Attestation): Promise<void> {
  const subnet = getAttestationSubnet(attestation);
  await promisify(this.pubsub.publish.bind(this.pubsub))(
    getAttestationSubnetTopic(attestation), serialize(attestation, this.config.types.Attestation));
  //backward compatible
  await promisify(this.pubsub.publish.bind(this.pubsub))(
    getGossipTopic(GossipEvent.ATTESTATION), serialize(attestation, this.config.types.Attestation)
  );
  this.logger.verbose(
    `Publishing attestation ${toHex(hashTreeRoot(attestation, this.config.types.Attestation))} for subnet ${subnet}`
  );
}
