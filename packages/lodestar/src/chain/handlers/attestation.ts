import {Attestation} from "@chainsafe/lodestar-types";
import {toHexString} from "@chainsafe/ssz";
import {BeaconChain} from "..";

export async function handleAttestation(this: BeaconChain, attestation: Attestation): Promise<void> {
  this.logger.debug("Attestation processed", {
    slot: attestation.data.slot,
    index: attestation.data.index,
    targetRoot: toHexString(attestation.data.target.root),
    aggregationBits: this.config.types.CommitteeBits.toJson(attestation.aggregationBits),
  });
}
