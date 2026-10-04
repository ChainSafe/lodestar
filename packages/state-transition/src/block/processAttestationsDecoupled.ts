import {decoupled} from "@lodestar/types";
import {CachedBeaconStateDecoupled} from "../types.js";
import {
  computeRoundAtSlot,
  getHeightParticipationFlags,
  getIndexedAttestation2,
  isValidAggregationBits,
  isValidAttestationData,
  isValidIndexedAttestation2,
  readHeightPair,
} from "../util/decoupled.js";

// Spec: process_attestation [Modified in DC] (decoupled-consensus/beacon-chain.md)
export function processAttestationsDecoupled(
  state: CachedBeaconStateDecoupled,
  attestations: decoupled.Attestation[],
  verifySignature = true
): void {
  const currentRound = computeRoundAtSlot(state.slot);
  const targetPair = readHeightPair(state.targetPair);
  const justifiedPair = readHeightPair(state.justifiedPair);
  const finalizedPair = readHeightPair(state.finalizedPair);

  for (const attestation of attestations) {
    const {data} = attestation;
    if (!isValidAttestationData(state, data)) {
      throw Error(
        `Invalid decoupled attestation data: round=${data.round} target=(${data.targetPair.height}) finalize=(${data.finalizePair.height})`
      );
    }
    if (!isValidAggregationBits(state, attestation)) {
      throw Error("Invalid decoupled attestation aggregation bits");
    }
    const indexedAttestation = getIndexedAttestation2(state, attestation);
    if (!isValidIndexedAttestation2(state, indexedAttestation, verifySignature)) {
      throw Error("Invalid decoupled indexed attestation");
    }

    const roundParticipation =
      data.round === currentRound ? state.currentRoundParticipation : state.previousRoundParticipation;

    // Current height participation counts in height and round participation
    const currentFlags = getHeightParticipationFlags(data, targetPair, justifiedPair);
    // Previous height participation counts in round participation only
    const previousFlags = getHeightParticipationFlags(data, justifiedPair, finalizedPair);

    // ParticipationFlags uses setBitwiseOR, so set() is add_flag
    for (const index of indexedAttestation.attestingIndices) {
      if (currentFlags !== 0) {
        state.heightParticipation.set(index, currentFlags);
        roundParticipation.set(index, currentFlags);
      }
      if (previousFlags !== 0) {
        roundParticipation.set(index, previousFlags);
      }
    }
    // [TODO in spec: proposer reward]
  }
}
