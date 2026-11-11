import {BeaconConfig} from "@lodestar/config";
import {XMSS_SIGNED_SIZE} from "@lodestar/native/leanvm";
import {pubkeyCache} from "@lodestar/native/pubkeys";
import {ForkBls, ForkName, LEAF_OFFSET_BEACON_PROPOSER, XMSS_SIGNATURE_SIZE} from "@lodestar/params";
import {
  ISignatureSet,
  SignatureSetType,
  computeXmssLeafIndex,
  getAttestationClaims,
  getAttestationDataSigningRoot,
  getAttesterSlashingSignatureSets,
  getIndexedAttestationProofSet,
} from "@lodestar/state-transition";
import {AttesterSlashing, RootHex, SingleAttestation, Slot, ValidatorIndex, phase0, pq} from "@lodestar/types";
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

/**
 * Verifies signatures that before pq were BLS and from pq are leanXMSS, each at the leaf of
 * `leafIndices` that the spec assigns its message.
 */
export async function verifySignatureSetsAtLeaves(
  verifiers: {bls: IBlsVerifier; pq: IPqVerifier},
  fork: ForkName,
  sets: ISignatureSet[],
  leafIndices: number[],
  opts?: VerifySignatureOpts
): Promise<boolean> {
  if (fork !== ForkName.pq) {
    return verifiers.bls.verifySignatureSets(sets, opts);
  }
  return verifiers.pq.verifySignatureSets(
    sets.map((set, i) => {
      if (set.type === SignatureSetType.aggregate) {
        throw Error("pq has no aggregate signatures");
      }
      return {
        pubkey: set.type === SignatureSetType.indexed ? getXmssPubkey(set.index) : set.pubkey,
        leafIndex: leafIndices[i],
        signingRoot: set.signingRoot,
        signature: set.signature,
      };
    })
  );
}

/** The leaves at which the two headers of a proposer slashing were signed */
export function getProposerSlashingLeafIndices(proposerSlashing: phase0.ProposerSlashing): number[] {
  return [proposerSlashing.signedHeader1, proposerSlashing.signedHeader2].map((signedHeader) =>
    computeXmssLeafIndex(Number(signedHeader.message.slot), LEAF_OFFSET_BEACON_PROPOSER)
  );
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
