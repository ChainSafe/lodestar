import {BeaconConfig} from "@lodestar/config";
import {XMSS_CLAIM_SIZE} from "@lodestar/native/leanvm";
import {
  DOMAIN_AGGREGATE_AND_PROOF,
  DOMAIN_BEACON_PROPOSER,
  LEAF_OFFSET_AGGREGATE_AND_PROOF,
  LEAF_OFFSET_BEACON_PROPOSER,
  LEAF_OFFSET_EXECUTION_PAYLOAD_BID,
  RESERVED_LEAF_VOLUNTARY_EXIT,
} from "@lodestar/params";
import {Slot, ValidatorIndex, phase0, pq, ssz} from "@lodestar/types";
import {computeStartSlotAtEpoch} from "../util/epoch.js";
import {computeXmssAttestationLeafIndex, computeXmssLeafIndex, verifyXmss} from "../util/pq.js";
import {computeSigningRoot} from "../util/signingRoot.js";
import {getExecutionPayloadBidSigningRoot} from "./executionPayloadBid.js";
import {getAttestationDataSigningRoot} from "./indexedAttestation.js";

/**
 * From the pq fork, what a verifier outside the state transition checks comes in two shapes: a
 * leanXMSS signature at the leaf its message is assigned, and a proof that every one of a set of
 * claims is backed by a signature.
 */
export type XmssSignatureSet = {
  pubkey: pq.XMSSPubkey;
  leafIndex: number;
  signingRoot: Uint8Array;
  signature: pq.XMSSSignature;
};

export type XmssProofSet = {
  /** Packed `(pubkey, signingRoot)` pairs, in no particular order and possibly repeated */
  claims: Uint8Array;
  proof: pq.AttestationProof;
};

/** Gives the leanXMSS public key of a validator */
export type XmssPubkeyGetter = (index: ValidatorIndex) => pq.XMSSPubkey;

export function verifyXmssSignatureSet(set: XmssSignatureSet): boolean {
  return verifyXmss(set.pubkey, set.leafIndex, set.signingRoot, set.signature);
}

export function getXmssBlockProposerSignatureSet(
  config: BeaconConfig,
  getPubkey: XmssPubkeyGetter,
  signedBlock: pq.SignedBeaconBlock
): XmssSignatureSet {
  const block = signedBlock.message;
  const domain = config.getDomain(block.slot, DOMAIN_BEACON_PROPOSER, block.slot);
  return {
    pubkey: getPubkey(block.proposerIndex),
    leafIndex: computeXmssLeafIndex(block.slot, LEAF_OFFSET_BEACON_PROPOSER),
    signingRoot: computeSigningRoot(ssz.pq.BeaconBlock, block, domain),
    signature: signedBlock.signature,
  };
}

/** Both headers of a proposer slashing were signed at the leaf of their slot */
export function getXmssProposerSlashingSignatureSets(
  config: BeaconConfig,
  stateSlot: Slot,
  getPubkey: XmssPubkeyGetter,
  proposerSlashing: pq.ProposerSlashing
): XmssSignatureSet[] {
  const pubkey = getPubkey(proposerSlashing.signedHeader1.message.proposerIndex);
  return [proposerSlashing.signedHeader1, proposerSlashing.signedHeader2].map((signedHeader) => {
    const slot = Number(signedHeader.message.slot as bigint);
    const domain = config.getDomain(stateSlot, DOMAIN_BEACON_PROPOSER, slot);
    return {
      pubkey,
      leafIndex: computeXmssLeafIndex(slot, LEAF_OFFSET_BEACON_PROPOSER),
      signingRoot: computeSigningRoot(ssz.phase0.BeaconBlockHeaderBigint, signedHeader.message, domain),
      signature: signedHeader.signature,
    };
  });
}

export function getXmssVoluntaryExitSignatureSet(
  config: BeaconConfig,
  stateSlot: Slot,
  getPubkey: XmssPubkeyGetter,
  signedVoluntaryExit: pq.SignedVoluntaryExit
): XmssSignatureSet {
  const messageSlot = computeStartSlotAtEpoch(signedVoluntaryExit.message.epoch);
  const domain = config.getDomainForVoluntaryExit(stateSlot, messageSlot);
  return {
    pubkey: getPubkey(signedVoluntaryExit.message.validatorIndex),
    leafIndex: RESERVED_LEAF_VOLUNTARY_EXIT,
    signingRoot: computeSigningRoot(ssz.phase0.VoluntaryExit, signedVoluntaryExit.message, domain),
    signature: signedVoluntaryExit.signature,
  };
}

export function getXmssExecutionPayloadBidSignatureSet(
  config: BeaconConfig,
  builderPubkey: pq.XMSSPubkey,
  signedBid: pq.SignedExecutionPayloadBid
): XmssSignatureSet {
  return {
    pubkey: builderPubkey,
    leafIndex: computeXmssLeafIndex(signedBid.message.slot, LEAF_OFFSET_EXECUTION_PAYLOAD_BID),
    signingRoot: getExecutionPayloadBidSigningRoot(config, signedBid.message),
    signature: signedBid.signature,
  };
}

export function getXmssAggregateAndProofSignatureSet(
  config: BeaconConfig,
  getPubkey: XmssPubkeyGetter,
  signedAggregateAndProof: pq.SignedAggregateAndProof
): XmssSignatureSet {
  const {message} = signedAggregateAndProof;
  const slot = message.aggregate.data.slot;
  const domain = config.getDomain(slot, DOMAIN_AGGREGATE_AND_PROOF, slot);
  return {
    pubkey: getPubkey(message.aggregatorIndex),
    leafIndex: computeXmssLeafIndex(slot, LEAF_OFFSET_AGGREGATE_AND_PROOF),
    signingRoot: computeSigningRoot(ssz.pq.AggregateAndProof, message, domain),
    signature: signedAggregateAndProof.signature,
  };
}

/** A single attestation is signed at the leaf of its target epoch */
export function getXmssAttestationSignatureSet(
  config: BeaconConfig,
  stateSlot: Slot,
  getPubkey: XmssPubkeyGetter,
  attestation: pq.SingleAttestation
): XmssSignatureSet {
  return {
    pubkey: getPubkey(attestation.attesterIndex),
    leafIndex: computeXmssAttestationLeafIndex(attestation.data.target.epoch),
    signingRoot: getAttestationDataSigningRoot(config, stateSlot, attestation.data),
    signature: attestation.signature,
  };
}

/** The claims that each of `attestingIndices` signed `data`, packed */
export function getAttestationClaims(
  config: BeaconConfig,
  stateSlot: Slot,
  getPubkey: XmssPubkeyGetter,
  data: phase0.AttestationData,
  attestingIndices: ValidatorIndex[]
): Uint8Array {
  const signingRoot = getAttestationDataSigningRoot(config, stateSlot, data);
  const claims = new Uint8Array(attestingIndices.length * XMSS_CLAIM_SIZE);
  for (let i = 0; i < attestingIndices.length; i++) {
    claims.set(getPubkey(attestingIndices[i]), i * XMSS_CLAIM_SIZE);
    claims.set(signingRoot, i * XMSS_CLAIM_SIZE + 32);
  }
  return claims;
}

/** What the `proof` of an indexed attestation, as an attester slashing holds two of, proves */
export function getIndexedAttestationProofSet(
  config: BeaconConfig,
  stateSlot: Slot,
  getPubkey: XmssPubkeyGetter,
  indexedAttestation: pq.IndexedAttestationBigint
): XmssProofSet {
  const data = ssz.phase0.AttestationData.deserialize(
    ssz.phase0.AttestationDataBigint.serialize(indexedAttestation.data)
  );
  return {
    claims: getAttestationClaims(config, stateSlot, getPubkey, data, indexedAttestation.attestingIndices),
    proof: indexedAttestation.proof,
  };
}

/**
 * Everything of a pq block that a verifier checks outside the state transition. The state
 * transition itself checks only preregistrations, whose validity decides the post-state.
 *
 * `attestingIndices` holds the attesters of each of the block's attestations, in order.
 */
export function getPqBlockSignatureSets(
  config: BeaconConfig,
  getPubkey: XmssPubkeyGetter,
  getBuilderPubkey: (builderIndex: number) => pq.XMSSPubkey,
  signedBlock: pq.SignedBeaconBlock,
  attestingIndices: ValidatorIndex[][],
  opts?: {skipProposerSignature?: boolean}
): {signatures: XmssSignatureSet[]; proofs: XmssProofSet[]} {
  const block = signedBlock.message;
  const {body} = block;
  if (attestingIndices.length !== body.attestations.length) {
    throw Error(
      `Attesting indices length mismatch: got ${attestingIndices.length}, expected ${body.attestations.length}`
    );
  }

  const signatures: XmssSignatureSet[] = [];
  const proofs: XmssProofSet[] = [];

  if (!opts?.skipProposerSignature) {
    signatures.push(getXmssBlockProposerSignatureSet(config, getPubkey, signedBlock));
  }
  for (const proposerSlashing of body.proposerSlashings) {
    signatures.push(...getXmssProposerSlashingSignatureSets(config, block.slot, getPubkey, proposerSlashing));
  }
  for (const attesterSlashing of body.attesterSlashings) {
    proofs.push(getIndexedAttestationProofSet(config, block.slot, getPubkey, attesterSlashing.attestation1));
    proofs.push(getIndexedAttestationProofSet(config, block.slot, getPubkey, attesterSlashing.attestation2));
  }
  for (const voluntaryExit of body.voluntaryExits) {
    signatures.push(getXmssVoluntaryExitSignatureSet(config, block.slot, getPubkey, voluntaryExit));
  }

  const bid = body.signedExecutionPayloadBid;
  if (bid.message.builderIndex !== Infinity) {
    signatures.push(getXmssExecutionPayloadBidSignatureSet(config, getBuilderPubkey(bid.message.builderIndex), bid));
  }

  // One proof covers the signatures of every attestation of the block
  const claims = body.attestations.map((attestation, i) =>
    getAttestationClaims(config, block.slot, getPubkey, attestation.data, attestingIndices[i])
  );
  proofs.push({claims: Buffer.concat(claims), proof: body.proof});

  return {signatures, proofs};
}
