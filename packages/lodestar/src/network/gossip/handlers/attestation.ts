/**
 * @module network/gossip
 */

import {Gossip, GossipHandlerFn} from "../gossip";
import {IGossipMessage, IGossipMessageValidator} from "../interface";
import {deserializeGossipMessage, getAttestationSubnet, getAttestationSubnetTopic, getGossipTopic} from "../utils";
import {Attestation} from "@chainsafe/eth2.0-types";
import {toHex} from "@chainsafe/eth2.0-utils";
import {GossipEvent} from "../constants";
import {promisify} from "es6-promisify";

export function getIncomingAttestationHandler(validator: IGossipMessageValidator): GossipHandlerFn {
  return async function handleIncomingAttestation(this: Gossip, msg: IGossipMessage): Promise<void> {
    try {
      const attestation = deserializeGossipMessage<Attestation>(this.config.types.Attestation, msg);
      this.logger.verbose(
        `Received attestation for block ${toHex(attestation.data.beaconBlockRoot)}`
          +` (${attestation.data.source.epoch}, ${attestation.data.target.epoch})`
      );
      if (await validator.isValidIncomingUnaggregatedAttestation(attestation)) {
        this.emit(GossipEvent.ATTESTATION, attestation);
      }
    } catch (e) {
      this.logger.warn("Incoming attestation error", e);
    }
  };
}

export function getCommitteeAttestationHandler(subnet: number, validator: IGossipMessageValidator): GossipHandlerFn {
  return function handleIncomingCommitteeAttestation(this: Gossip, msg: IGossipMessage): void {
    try {
      const attestation = deserializeGossipMessage<Attestation>(this.config.types.Attestation, msg);
      this.logger.verbose(
        `Received committee attestation for block ${toHex(attestation.data.beaconBlockRoot)}`
          +`subnet: ${subnet}, (${attestation.data.source.epoch}, ${attestation.data.target.epoch})`
      );

      validator.isValidIncomingCommitteeAttestation(attestation, subnet).then((isValid: boolean) => {
        if (isValid) {
          this.emit(GossipEvent.ATTESTATION_SUBNET, {attestation, subnet});
        }
      });
    } catch (e) {
      this.logger.warn("Incoming committee attestation error", e);
    }
  };
}

export async function publishCommiteeAttestation(this: Gossip, attestation: Attestation): Promise<void> {
  const subnet = getAttestationSubnet(attestation);
  await promisify<void, string, Uint8Array>(this.pubsub.publish.bind(this.pubsub))(
    getAttestationSubnetTopic(attestation), this.config.types.Attestation.serialize(attestation));
  //backward compatible
  await promisify<void, string, Uint8Array>(this.pubsub.publish.bind(this.pubsub))(
    getGossipTopic(GossipEvent.ATTESTATION), this.config.types.Attestation.serialize(attestation)
  );
  this.logger.verbose(
    `Publishing attestation ${toHex(this.config.types.Attestation.hashTreeRoot(attestation))} for subnet ${subnet}`
  );
}
