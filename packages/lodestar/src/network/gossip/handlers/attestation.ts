/**
 * @module network/gossip
 */

import {toHexString} from "@chainsafe/ssz";
import {Gossip, GossipHandlerFn} from "../gossip";
import {getGossipTopic, getAttestationSubnetEvent} from "../utils";
import {Attestation} from "@chainsafe/lodestar-types";
import {GossipEvent} from "../constants";
import {GossipObject} from "../interface";
import {computeSubnetForAttestation} from "@chainsafe/lodestar-beacon-state-transition";
import {GossipEncoding} from "../encoding";

export function getCommitteeAttestationHandler(subnet: number): GossipHandlerFn {
  return function handleIncomingCommitteeAttestation(this: Gossip, obj: GossipObject): void {
    try {
      const attestation = obj as Attestation;
      this.logger.verbose(
        `Received committee attestation for block ${toHexString(attestation.data.beaconBlockRoot)}`
          +`subnet: ${subnet}, (${attestation.data.source.epoch}, ${attestation.data.target.epoch})`
      );
      // @ts-ignore
      this.emit(getAttestationSubnetEvent(subnet), {attestation, subnet});
    } catch (e) {
      this.logger.warn("Incoming committee attestation error", e);
    }
  };
}

export async function publishCommiteeAttestation(this: Gossip, attestation: Attestation): Promise<void> {
  const forkDigestValue = await this.getForkDigest(attestation.data.slot);
  const {state: headState} = await this.chain.getHeadContext();
  const subnet = computeSubnetForAttestation(this.config, headState, attestation);
  await this.pubsub.publish(
    getGossipTopic(
      GossipEvent.ATTESTATION_SUBNET,
      forkDigestValue,
      GossipEncoding.SSZ_SNAPPY,
      new Map([["subnet", String(subnet)]])
    ),
    Buffer.from(this.config.types.Attestation.serialize(attestation)));
  const attestationHex = toHexString(this.config.types.Attestation.hashTreeRoot(attestation));
  this.logger.verbose(
    `Publishing attestation ${attestationHex} for subnet ${subnet}`
  );
}
