import {BeaconConfig} from "@lodestar/config";
import {DOMAIN_PTC_ATTESTER} from "@lodestar/params";
import {gloas, ssz} from "@lodestar/types";
import {ISignatureSet, computeSigningRoot, createAggregateSignatureSetFromComponents} from "../util/index.js";

export function getIndexedPayloadAttestationSignatureSet(
  config: BeaconConfig,
  indexedPayloadAttestation: gloas.IndexedPayloadAttestation
): ISignatureSet {
  return createAggregateSignatureSetFromComponents(
    indexedPayloadAttestation.attestingIndices,
    getPayloadAttestationDataSigningRoot(config, indexedPayloadAttestation.data),
    indexedPayloadAttestation.signature
  );
}

export function getPayloadAttestationDataSigningRoot(
  config: BeaconConfig,
  data: gloas.PayloadAttestationData
): Uint8Array {
  const domain = config.getDomain(data.slot, DOMAIN_PTC_ATTESTER);

  return computeSigningRoot(ssz.gloas.PayloadAttestationData, data, domain);
}
