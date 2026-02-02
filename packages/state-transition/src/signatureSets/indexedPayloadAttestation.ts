import {BeaconConfig} from "@lodestar/config";
import {DOMAIN_PTC_ATTESTER} from "@lodestar/params";
import {Slot, gloas, ssz} from "@lodestar/types";
import {CachedBeaconStateGloas} from "../types.js";
import {ISignatureSet, computeSigningRoot, createAggregateSignatureSetFromComponents} from "../util/index.js";

export function getIndexedPayloadAttestationSignatureSet(
  state: CachedBeaconStateGloas,
  indexedPayloadAttestation: gloas.IndexedPayloadAttestation
): ISignatureSet {
  return createAggregateSignatureSetFromComponents(
    indexedPayloadAttestation.attestingIndices,
    getPayloadAttestationDataSigningRoot(state.config, state.slot, indexedPayloadAttestation.data),
    indexedPayloadAttestation.signature
  );
}

export function getPayloadAttestationDataSigningRoot(
  config: BeaconConfig,
  stateSlot: Slot,
  data: gloas.PayloadAttestationData
): Uint8Array {
  const domain = config.getDomain(stateSlot, DOMAIN_PTC_ATTESTER);

  return computeSigningRoot(ssz.gloas.PayloadAttestationData, data, domain);
}
