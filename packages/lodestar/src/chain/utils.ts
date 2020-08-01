import {BeaconBlock} from "@chainsafe/lodestar-types";

export function getBlockAttestationCount(block: BeaconBlock): number {
  return Array.from(
    block.body.attestations
  ).reduce((count, attestation) => {
    return count + Array.from(attestation.aggregationBits).filter(bit => !!bit).length;
  }, 0);
}
