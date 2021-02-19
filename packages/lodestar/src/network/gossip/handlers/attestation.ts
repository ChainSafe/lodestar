/**
 * @module network/gossip
 */

import {toHexString} from "@chainsafe/ssz";
import {Gossip, GossipHandlerFn} from "../gossip";
import {getGossipTopic, getAttestationSubnetEvent} from "../utils";
import {phase0} from "@chainsafe/lodestar-types";
import {GossipEvent} from "../constants";
import {GossipObject} from "../interface";
import {computeSubnetForAttestation} from "@chainsafe/lodestar-beacon-state-transition";
import {GossipEncoding} from "../encoding";

export function getCommitteeAttestationHandler(subnet: number): GossipHandlerFn {
  return function handleIncomingCommitteeAttestation(this: Gossip, obj: GossipObject): void {
    try {
      const attestation = obj as phase0.Attestation;

      this.logger.verbose("Received committee attestation", {
        block: toHexString(attestation.data.beaconBlockRoot),
        subnet,
        source: attestation.data.source.epoch,
        target: attestation.data.target.epoch,
      });

      // attestation subnet event is dynamic, so it is not typed and declared in IGossipEvents
      // @ts-ignore
      this.emit(getAttestationSubnetEvent(subnet), {attestation, subnet});
    } catch (e) {
      this.logger.warn("Incoming committee attestation error", e);
    }
  };
}

export async function publishCommiteeAttestation(this: Gossip, attestation: phase0.Attestation): Promise<void> {
  const forkDigestValue = this.getForkDigest(attestation.data.slot);
  const headState = this.chain.getHeadState();
  const subnet = computeSubnetForAttestation(this.config, headState, attestation);

  await this.pubsub.publish(
    getGossipTopic(
      GossipEvent.ATTESTATION_SUBNET,
      forkDigestValue,
      GossipEncoding.SSZ_SNAPPY,
      new Map([["subnet", String(subnet)]])
    ),
    Buffer.from(this.config.types.phase0.Attestation.serialize(attestation))
  );

  const attestationHex = toHexString(this.config.types.phase0.Attestation.hashTreeRoot(attestation));
  this.logger.verbose("Publishing attestation", {attestationHex, subnet});
}
