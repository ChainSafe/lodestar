/**
 * @module network/gossip
 */

import {toHexString} from "@chainsafe/ssz";
import {Gossip, GossipHandlerFn} from "../gossip";
import {getAttestationSubnet, getAttestationSubnetTopic, getGossipTopic} from "../utils";
import {Attestation} from "@chainsafe/lodestar-types";
import {GossipEvent} from "../constants";
import {GossipObject} from "../interface";

export async function handleIncomingAttestation(this: Gossip, obj: GossipObject): Promise<void> {
  try {
    const attestation = obj as Attestation;
    this.logger.verbose(
      `Received attestation for block ${toHexString(attestation.data.beaconBlockRoot)}`
        +` (${attestation.data.source.epoch}, ${attestation.data.target.epoch})`
    );
    this.emit(GossipEvent.ATTESTATION, attestation);
  } catch (e) {
    this.logger.warn("Incoming attestation error", e);
  }
}

export function getCommitteeAttestationHandler(subnet: number): GossipHandlerFn {
  return function handleIncomingCommitteeAttestation(this: Gossip, obj: GossipObject): void {
    try {
      const attestation = obj as Attestation;
      this.logger.verbose(
        `Received committee attestation for block ${toHexString(attestation.data.beaconBlockRoot)}`
          +`subnet: ${subnet}, (${attestation.data.source.epoch}, ${attestation.data.target.epoch})`
      );
      this.emit(GossipEvent.ATTESTATION_SUBNET, {attestation, subnet});
    } catch (e) {
      this.logger.warn("Incoming committee attestation error", e);
    }
  };
}

export async function publishCommiteeAttestation(this: Gossip, attestation: Attestation): Promise<void> {
  const forkDigestValue = await this.getForkDigest(attestation.data.slot);
  const subnet = getAttestationSubnet(attestation);
  await this.pubsub.publish(
    getAttestationSubnetTopic(attestation, forkDigestValue),
    Buffer.from(this.config.types.Attestation.serialize(attestation)));
  //backward compatible
  await this.pubsub.publish(
    getGossipTopic(GossipEvent.ATTESTATION, forkDigestValue),
    Buffer.from(this.config.types.Attestation.serialize(attestation))
  );
  const attestationHex = toHexString(this.config.types.Attestation.hashTreeRoot(attestation));
  this.logger.verbose(
    `Publishing attestation ${attestationHex} for subnet ${subnet}`
  );
}
