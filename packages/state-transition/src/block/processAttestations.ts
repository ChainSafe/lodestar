import {ForkPreDecoupled, ForkSeq} from "@lodestar/params";
import {Attestation, Slot, decoupled} from "@lodestar/types";
import {BeaconStateTransitionMetrics} from "../metrics.js";
import {
  CachedBeaconStateAllForks,
  CachedBeaconStateAltair,
  CachedBeaconStateDecoupled,
  CachedBeaconStatePhase0,
} from "../types.js";
import {processAttestationPhase0} from "./processAttestationPhase0.js";
import {processAttestationsAltair} from "./processAttestationsAltair.js";
import {processAttestationsDecoupled} from "./processAttestationsDecoupled.js";

/**
 * TODO
 */
export function processAttestations(
  fork: ForkSeq,
  state: CachedBeaconStateAllForks,
  attestations: Attestation[],
  parentSlot: Slot | null,
  verifySignatures = true,
  metrics?: BeaconStateTransitionMetrics | null
): void {
  if (fork >= ForkSeq.decoupled) {
    processAttestationsDecoupled(
      state as CachedBeaconStateDecoupled,
      attestations as decoupled.Attestation[],
      verifySignatures
    );
    metrics?.attestationsPerBlock.set(attestations.length);
  } else if (fork === ForkSeq.phase0) {
    for (const attestation of attestations) {
      processAttestationPhase0(
        state as CachedBeaconStatePhase0,
        attestation as Attestation<ForkPreDecoupled>,
        verifySignatures
      );
    }
  } else {
    processAttestationsAltair(
      fork,
      state as CachedBeaconStateAltair,
      attestations as Attestation<ForkPreDecoupled>[],
      parentSlot,
      verifySignatures,
      metrics
    );
  }
}
