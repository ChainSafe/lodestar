import {byteArrayEquals} from "@chainsafe/ssz";
import {gloas} from "@lodestar/types";
import {CachedBeaconStateGloas} from "../types.ts";
import {isValidIndexedPayloadAttestation} from "./isValidIndexedPayloadAttestation.ts";

export function processPayloadAttestation(
  state: CachedBeaconStateGloas,
  payloadAttestations: gloas.PayloadAttestation[]
): void {
  for (const payloadAttestation of payloadAttestations) {
    const data = payloadAttestation.data;

    if (byteArrayEquals(data.beaconBlockRoot, state.latestBlockHeader.parentRoot)) {
      throw Error("Payload attestation is referring to the wrong block");
    }

    if (data.slot + 1 !== state.slot) {
      throw Error("Payload attestation is not from previous slot");
    }

    const indexedPayloadAttestation = state.epochCtx.getIndexedPayloadAttestation(payloadAttestation);

    if (!isValidIndexedPayloadAttestation(state, indexedPayloadAttestation, true)) {
      throw Error("Invalid payload attestation");
    }
  }
}
