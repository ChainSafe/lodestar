import {phase0} from "@lodestar/types";
import {ForkSeq} from "@lodestar/params";
import {CachedBeaconStateAllForks, CachedBeaconStateAltair, CachedBeaconStatePhase0} from "../types.js";
import {processAttestationPhase0} from "./processAttestationPhase0.js";
import {processAttestationsAltair} from "./processAttestationsAltair.js";

/**
 * TODO
 */
export function processAttestations(
  fork: ForkSeq,
  state: CachedBeaconStateAllForks,
  attestations: phase0.Attestation[],
  verifySignatures = true
): void {
  if (fork === ForkSeq.phase0) {
    for (const attestation of attestations) {
      processAttestationPhase0(state as CachedBeaconStatePhase0, attestation, verifySignatures);
    }
  } else {
    processAttestationsAltair(state as CachedBeaconStateAltair, attestations, verifySignatures);
  }
}
