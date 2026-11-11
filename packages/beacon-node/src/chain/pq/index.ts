import {BeaconConfig} from "@lodestar/config";
import {XMSS_SIGNED_SIZE} from "@lodestar/native/leanvm";
import {pubkeyCache} from "@lodestar/native/pubkeys";
import {ForkBls, ForkName, XMSS_SIGNATURE_SIZE} from "@lodestar/params";
import {
  getAttestationClaims,
  getAttestationDataSigningRoot,
  getAttesterSlashingSignatureSets,
  getIndexedAttestationProofSet,
} from "@lodestar/state-transition";
import {AttesterSlashing, RootHex, SingleAttestation, Slot, ValidatorIndex, pq} from "@lodestar/types";
import {IBlsVerifier} from "../bls/index.js";
import {VerifySignatureOpts} from "../bls/interface.js";
import {PqAttestationPool} from "../opPools/pqAttestationPool.js";
import {InsertOutcome} from "../opPools/types.js";
import {IPqVerifier} from "./verifier.js";

export * from "./verifier.js";

/**
 * The leanXMSS public key of a validator. The pubkey cache holds it as requests name it: 16 zero
 * bytes, then the key.
 */
export function getXmssPubkey(index: ValidatorIndex): pq.XMSSPubkey {
  return pubkeyCache.getPubkeyBytesOrThrow(index).subarray(16);
}

/** From pq a single attestation carries a leanXMSS signature */
export function isPqSingleAttestation(attestation: SingleAttestation): attestation is pq.SingleAttestation {
  return attestation.signature.length === XMSS_SIGNATURE_SIZE;
}

/** Keeps a verified single attestation's signature for an aggregator or a proposer to prove */
export function addPqSingleAttestation(
  config: BeaconConfig,
  pool: PqAttestationPool,
  attestation: pq.SingleAttestation,
  attDataRootHex: RootHex,
  validatorCommitteeIndex: number,
  committeeSize: number
): InsertOutcome {
  const {data} = attestation;
  const signed = new Uint8Array(XMSS_SIGNED_SIZE);
  signed.set(getXmssPubkey(attestation.attesterIndex), 0);
  signed.set(getAttestationDataSigningRoot(config, data.slot, data), 32);
  signed.set(attestation.signature, 64);
  return pool.addSingle(
    attestation.committeeIndex,
    data,
    attDataRootHex,
    validatorCommitteeIndex,
    committeeSize,
    signed
  );
}

/** Keeps a verified aggregate and its proof for a proposer to merge */
export function addPqAggregate(
  config: BeaconConfig,
  pool: PqAttestationPool,
  aggregateAndProof: pq.AggregateAndProof,
  attDataRootHex: RootHex,
  attestingIndices: ValidatorIndex[]
): InsertOutcome {
  const {aggregate, proof} = aggregateAndProof;
  const committeeIndex = aggregate.committeeBits.getSingleTrueBit();
  if (committeeIndex === null) throw Error("A network aggregate covers one committee");
  return pool.addAggregate(
    committeeIndex,
    aggregate.data,
    attDataRootHex,
    aggregate.aggregationBits,
    proof,
    getAttestationClaims(config, aggregate.data.slot, getXmssPubkey, aggregate.data, attestingIndices)
  );
}

/**
 * Checks the two indexed attestations of an attester slashing: their aggregate BLS signatures, or
 * from pq their proofs.
 */
export async function verifyAttesterSlashingSignatures(
  config: BeaconConfig,
  bls: IBlsVerifier,
  pq: IPqVerifier,
  stateSlot: Slot,
  attesterSlashing: AttesterSlashing,
  opts?: VerifySignatureOpts
): Promise<boolean> {
  if ("proof" in attesterSlashing.attestation1) {
    const pqSlashing = attesterSlashing as AttesterSlashing<ForkName.pq>;
    return pq.verifyProofSets([
      getIndexedAttestationProofSet(config, stateSlot, getXmssPubkey, pqSlashing.attestation1),
      getIndexedAttestationProofSet(config, stateSlot, getXmssPubkey, pqSlashing.attestation2),
    ]);
  }
  return bls.verifySignatureSets(
    getAttesterSlashingSignatureSets(config, stateSlot, attesterSlashing as AttesterSlashing<ForkBls>),
    opts
  );
}
