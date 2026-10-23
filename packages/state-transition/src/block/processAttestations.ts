import {ForkPreEip8453, ForkSeq} from "@lodestar/params";
import {Attestation, Slot} from "@lodestar/types";
import {BeaconStateTransitionMetrics} from "../metrics.js";
import {CachedBeaconStateAllForks, CachedBeaconStateAltair, CachedBeaconStatePhase0} from "../types.js";
import {processAttestationPhase0} from "./processAttestationPhase0.js";
import {processAttestationsAltair} from "./processAttestationsAltair.js";

/**
 * TODO
 */
export function processAttestations(
  fork: ForkSeq,
  state: CachedBeaconStateAllForks,
  attestations: Attestation<ForkPreEip8453>[],
  parentSlot: Slot | null,
  verifySignatures = true,
  metrics?: BeaconStateTransitionMetrics | null
): void {
  if (fork === ForkSeq.phase0) {
    for (const attestation of attestations) {
      processAttestationPhase0(state as CachedBeaconStatePhase0, attestation, verifySignatures);
    }
  } else {
    processAttestationsAltair(
      fork,
      state as CachedBeaconStateAltair,
      attestations,
      parentSlot,
      verifySignatures,
      metrics
    );
  }
}
