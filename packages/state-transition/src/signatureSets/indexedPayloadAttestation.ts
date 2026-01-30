import {DOMAIN_PTC_ATTESTER} from "@lodestar/params";
import {gloas, ssz} from "@lodestar/types";
import {CachedBeaconStateGloas} from "../types.js";
import {ISignatureSet, computeSigningRoot, createAggregateSignatureSetFromComponents} from "../util/index.js";

export function getIndexedPayloadAttestationSignatureSet(
  state: CachedBeaconStateGloas,
  indexedPayloadAttestation: gloas.IndexedPayloadAttestation
): ISignatureSet {
  return createAggregateSignatureSetFromComponents(
    indexedPayloadAttestation.attestingIndices.map((i) => state.epochCtx.index2pubkey[i]),
    getPayloadAttestationDataSigningRoot(state, indexedPayloadAttestation.data),
    indexedPayloadAttestation.signature
  );
}

export function getPayloadAttestationDataSigningRoot(
  state: CachedBeaconStateGloas,
  data: gloas.PayloadAttestationData
): Uint8Array {
  const domain = state.config.getDomain(state.slot, DOMAIN_PTC_ATTESTER);

  return computeSigningRoot(ssz.gloas.PayloadAttestationData, data, domain);
}
