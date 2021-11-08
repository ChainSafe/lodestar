import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {DOMAIN_BEACON_ATTESTER} from "@chainsafe/lodestar-params";
import {allForks, phase0, ssz} from "@chainsafe/lodestar-types";
import {readonlyValues} from "@chainsafe/ssz";
import {
  computeSigningRoot,
  computeStartSlotAtEpoch,
  ISignatureSet,
  SignatureSetType,
  verifySignatureSet,
} from "../../util";
import {CachedBeaconState, Index2PubkeyCache} from "../util";

export function verifyIndexedAttestationSignature(
  state: CachedBeaconState<allForks.BeaconState>,
  indexedAttestation: phase0.IndexedAttestation,
  indices?: number[]
): boolean {
  return verifySignatureSet(
    getIndexedAttestationSignatureSet(state.config, state.epochCtx.index2pubkey, indexedAttestation, indices)
  );
}

export function getAttestationWithIndicesSignatureSet(
  config: IBeaconConfig,
  index2pubkey: Index2PubkeyCache,
  attestation: Pick<phase0.Attestation, "data" | "signature">,
  indices: number[]
): ISignatureSet {
  const slot = computeStartSlotAtEpoch(attestation.data.target.epoch);
  const domain = config.getDomain(DOMAIN_BEACON_ATTESTER, slot);

  return {
    type: SignatureSetType.aggregate,
    pubkeys: indices.map((i) => index2pubkey[i]),
    signingRoot: computeSigningRoot(ssz.phase0.AttestationData, attestation.data, domain),
    signature: attestation.signature.valueOf() as Uint8Array,
  };
}

export function getIndexedAttestationSignatureSet(
  config: IBeaconConfig,
  index2pubkey: Index2PubkeyCache,
  indexedAttestation: phase0.IndexedAttestation,
  indices?: number[]
): ISignatureSet {
  return getAttestationWithIndicesSignatureSet(
    config,
    index2pubkey,
    indexedAttestation,
    indices ?? Array.from(readonlyValues(indexedAttestation.attestingIndices))
  );
}

export function getAttestationsSignatureSets(
  state: CachedBeaconState<allForks.BeaconState>,
  signedBlock: allForks.SignedBeaconBlock
): ISignatureSet[] {
  return Array.from(readonlyValues(signedBlock.message.body.attestations), (attestation) =>
    getIndexedAttestationSignatureSet(
      state.config,
      state.epochCtx.index2pubkey,
      state.getIndexedAttestation(attestation)
    )
  );
}
