import {gloas} from "@lodestar/types";
import {CachedBeaconStateGloas} from "../types.js";

export function isValidIndexedPayloadAttestation(
  state: CachedBeaconStateGloas,
  indexedPayloadAttestation: gloas.IndexedPayloadAttestation,
  verifySignature: boolean
): boolean {
  throw Error("Unimplemented");
}
