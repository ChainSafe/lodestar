import {
  ATTESTATION_COMMITTEES_PER_ROUND,
  ATTESTATION_SUBNET_COUNT,
  DOMAIN_FINALITY_ATTESTER,
  DOMAIN_HEAD_VOTE,
  ForkSeq,
} from "@lodestar/params";
import {
  CachedBeaconStateEip8453,
  computeEpochAtSlot,
  computeSigningRoot,
  computeStartSlotAtEpoch,
  createSingleSignatureSetFromComponents,
  getAttestationCommittee,
  getHeadVoteCommittee,
  isWellFormedAttestationData,
} from "@lodestar/state-transition";
import {RootHex, eip8453, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {asCachedStateEip8453} from "../eip8453/state.js";
import {GossipAction, GossipActionError} from "../errors/index.js";
import {IBeaconChain} from "../interface.js";
import {RegenCaller} from "../regen/index.js";

/**
 * [EIP8453] Validation of head vote messages and finality gadget attestations received over gossip or the API,
 * after p2p-interface.md `validate_head_vote_gossip` / `validate_attestation_gossip`, minus the fork choice
 * conditions that need the Goldilocks store (payload status consistency, finalized ancestry).
 */

export enum Eip8453GossipErrorCode {
  PRE_FORK = "EIP8453_PRE_FORK",
  NOT_CURRENT_SLOT = "EIP8453_HEAD_VOTE_NOT_CURRENT_SLOT",
  UNKNOWN_BLOCK = "EIP8453_UNKNOWN_BLOCK",
  BLOCK_AFTER_VOTE = "EIP8453_BLOCK_AFTER_VOTE",
  NOT_IN_COMMITTEE = "EIP8453_NOT_IN_COMMITTEE",
  INVALID_SIGNATURE = "EIP8453_INVALID_SIGNATURE",
  COMMITTEE_INDEX_OUT_OF_RANGE = "EIP8453_COMMITTEE_INDEX_OUT_OF_RANGE",
  WRONG_SUBNET = "EIP8453_WRONG_SUBNET",
  MALFORMED_DATA = "EIP8453_MALFORMED_ATTESTATION_DATA",
  EPOCH_NOT_CURRENT = "EIP8453_ATTESTATION_EPOCH_NOT_CURRENT",
}

/** Spec: compute_subnet_for_attestation [Modified in EIP8453] */
export function computeSubnetForFinalityAttestation(committeeIndex: number): number {
  return committeeIndex % ATTESTATION_SUBNET_COUNT;
}

export type HeadVoteValidationResult = {dataRootHex: RootHex; state: CachedBeaconStateEip8453};

export async function validateHeadVoteMessage(
  chain: IBeaconChain,
  message: eip8453.HeadVoteMessage,
  /** The API accepts votes of the previous slot too; gossip only the current slot */
  allowPreviousSlot = false
): Promise<HeadVoteValidationResult> {
  const {data, validatorIndex} = message;
  const currentSlot = chain.clock.currentSlot;
  if (chain.config.getForkSeq(data.slot) < ForkSeq.eip8453) {
    throw new GossipActionError(GossipAction.REJECT, {code: Eip8453GossipErrorCode.PRE_FORK});
  }
  if (data.slot !== currentSlot && !(allowPreviousSlot && data.slot === currentSlot - 1)) {
    throw new GossipActionError(GossipAction.IGNORE, {code: Eip8453GossipErrorCode.NOT_CURRENT_SLOT});
  }
  const blockRootHex = toRootHex(data.beaconBlockRoot);
  const block = chain.forkChoice.getBlockHexDefaultStatus(blockRootHex);
  if (block === null) {
    throw new GossipActionError(GossipAction.IGNORE, {code: Eip8453GossipErrorCode.UNKNOWN_BLOCK});
  }
  if (block.slot > data.slot) {
    throw new GossipActionError(GossipAction.REJECT, {code: Eip8453GossipErrorCode.BLOCK_AFTER_VOTE});
  }

  const state = asCachedStateEip8453(await chain.getHeadStateAtCurrentEpoch(RegenCaller.validateGossipAttestation));
  const committee = getHeadVoteCommittee(state, data.slot);
  if (!committee.includes(validatorIndex)) {
    throw new GossipActionError(GossipAction.REJECT, {code: Eip8453GossipErrorCode.NOT_IN_COMMITTEE});
  }

  const domain = state.config.getDomain(state.slot, DOMAIN_HEAD_VOTE, data.slot);
  const signingRoot = computeSigningRoot(ssz.eip8453.HeadVoteData, data, domain);
  const signatureSet = createSingleSignatureSetFromComponents(
    state.epochCtx.pubkeyCache.getPubkeyBytesOrThrow(validatorIndex),
    signingRoot,
    message.signature
  );
  if (!(await chain.bls.verifySignatureSets([signatureSet]))) {
    throw new GossipActionError(GossipAction.REJECT, {code: Eip8453GossipErrorCode.INVALID_SIGNATURE});
  }
  return {dataRootHex: toRootHex(ssz.eip8453.HeadVoteData.hashTreeRoot(data)), state};
}

export type FinalityAttestationValidationResult = {dataRootHex: RootHex; subnet: number};

export async function validateFinalityAttestation(
  chain: IBeaconChain,
  attestation: eip8453.SingleAttestation,
  subnet: number | null
): Promise<FinalityAttestationValidationResult> {
  const {data, committeeIndex, attesterIndex, epoch} = attestation;
  if (committeeIndex >= ATTESTATION_COMMITTEES_PER_ROUND) {
    throw new GossipActionError(GossipAction.REJECT, {code: Eip8453GossipErrorCode.COMMITTEE_INDEX_OUT_OF_RANGE});
  }
  const expectedSubnet = computeSubnetForFinalityAttestation(committeeIndex);
  if (subnet !== null && subnet !== expectedSubnet) {
    throw new GossipActionError(GossipAction.REJECT, {code: Eip8453GossipErrorCode.WRONG_SUBNET});
  }
  if (chain.config.getForkSeq(computeStartSlotAtEpoch(epoch)) < ForkSeq.eip8453) {
    throw new GossipActionError(GossipAction.REJECT, {code: Eip8453GossipErrorCode.PRE_FORK});
  }
  // The attestation is cast in the slot of its committee; accept the current and previous epoch
  const currentEpoch = computeEpochAtSlot(chain.clock.currentSlot);
  if (epoch !== currentEpoch && epoch !== currentEpoch - 1) {
    throw new GossipActionError(GossipAction.IGNORE, {code: Eip8453GossipErrorCode.EPOCH_NOT_CURRENT});
  }
  if (!isWellFormedAttestationData(data)) {
    throw new GossipActionError(GossipAction.REJECT, {code: Eip8453GossipErrorCode.MALFORMED_DATA});
  }
  if (chain.forkChoice.getBlockHexDefaultStatus(toRootHex(data.target.root)) === null) {
    throw new GossipActionError(GossipAction.IGNORE, {code: Eip8453GossipErrorCode.UNKNOWN_BLOCK});
  }

  const state = asCachedStateEip8453(await chain.getHeadStateAtCurrentEpoch(RegenCaller.validateGossipAttestation));
  const committee = getAttestationCommittee(state, epoch, committeeIndex);
  if (!committee.includes(attesterIndex)) {
    throw new GossipActionError(GossipAction.REJECT, {code: Eip8453GossipErrorCode.NOT_IN_COMMITTEE});
  }

  const domain = state.config.getDomain(state.slot, DOMAIN_FINALITY_ATTESTER, computeStartSlotAtEpoch(epoch));
  const signingRoot = computeSigningRoot(ssz.eip8453.AttestationData, data, domain);
  const signatureSet = createSingleSignatureSetFromComponents(
    state.epochCtx.pubkeyCache.getPubkeyBytesOrThrow(attesterIndex),
    signingRoot,
    attestation.signature
  );
  if (!(await chain.bls.verifySignatureSets([signatureSet]))) {
    throw new GossipActionError(GossipAction.REJECT, {code: Eip8453GossipErrorCode.INVALID_SIGNATURE});
  }
  return {dataRootHex: toRootHex(ssz.eip8453.AttestationData.hashTreeRoot(data)), subnet: expectedSubnet};
}
