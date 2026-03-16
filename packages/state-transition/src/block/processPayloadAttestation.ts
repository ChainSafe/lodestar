import {gloas} from "@lodestar/types";
import {byteArrayEquals} from "@lodestar/utils";
import {CachedBeaconStateGloas} from "../types.js";
import {isValidIndexedPayloadAttestation} from "./isValidIndexedPayloadAttestation.js";
import {getIndexedPayloadAttestation} from "../util/gloas.js";

export function processPayloadAttestation(
  state: CachedBeaconStateGloas,
  payloadAttestation: gloas.PayloadAttestation
): void {
  const data = payloadAttestation.data;

  if (!byteArrayEquals(data.beaconBlockRoot, state.latestBlockHeader.parentRoot)) {
    throw Error("Payload attestation is referring to the wrong block");
  }

  if (data.slot + 1 !== state.slot) {
    throw Error("Payload attestation is not from previous slot");
  }

  const indexedPayloadAttestation = getIndexedPayloadAttestation(state, payloadAttestation);

  if (!isValidIndexedPayloadAttestation(state, indexedPayloadAttestation, true)) {
    throw Error("Invalid payload attestation");
  }
}
