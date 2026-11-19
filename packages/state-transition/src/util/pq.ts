import {digest} from "@chainsafe/as-sha256";
import {ChainForkConfig} from "@lodestar/config";
import {verifyXmssSignature} from "@lodestar/native/leanvm";
import {computePtcIndices} from "@lodestar/native/shuffle";
import {isValidVrfProof as isValidNativeVrfProof} from "@lodestar/native/vrf-tree";
import {
  AGGREGATORS_PER_COMMITTEE,
  ATTESTATION_SUBNET_COUNT,
  DOMAIN_SELECTION_PROOF,
  EFFECTIVE_BALANCE_INCREMENT,
  ForkName,
  MAX_EFFECTIVE_BALANCE_ELECTRA,
  MIN_SEED_LOOKAHEAD,
  SLOTS_PER_EPOCH,
  VRF_TREE_DEPTH,
  XMSS_ATTESTATION_LEAVES,
  XMSS_BUILDER_BID_LEAVES,
  XMSS_LEAVES_PER_SLOT,
  XMSS_RESERVED_LEAVES,
  XMSS_SIGNATURE_SIZE,
} from "@lodestar/params";
import {Epoch, Slot, ValidatorIndex, pq, ssz} from "@lodestar/types";
import {BeaconStateAllForks, CachedBeaconStateAllForks} from "../types.js";
import {computeEpochAtSlot, computeStartSlotAtEpoch} from "./epoch.js";
import {computeEpochShuffling} from "./epochShuffling.js";
import {getSeed} from "./seed.js";
import {getActiveValidatorIndices} from "./validator.js";

const XMSS_REQUEST_PREFIX_SIZE = 16;
const LEGACY_XMSS_PUBKEY_DOMAIN = 0x00;
const LEGACY_VRF_ROOT_DOMAIN = 0x01;

/** The number of attestation subnets at `slot`: fewer from pq */
export function getAttestationSubnetCount(config: ChainForkConfig, slot: Slot): number {
  return config.getForkName(slot) === ForkName.pq ? config.ATTESTATION_SUBNET_COUNT_PQ : ATTESTATION_SUBNET_COUNT;
}

/** The leaf at which an attestation is signed for target `epoch` */
export function computeXmssAttestationLeafIndex(epoch: Epoch): number {
  return XMSS_RESERVED_LEAVES + epoch;
}

/** The leaf at which the message of the type `leafOffset` is signed for `slot` */
export function computeXmssLeafIndex(slot: Slot, leafOffset: number): number {
  return (
    XMSS_RESERVED_LEAVES + XMSS_ATTESTATION_LEAVES + XMSS_BUILDER_BID_LEAVES + slot * XMSS_LEAVES_PER_SLOT + leafOffset
  );
}

/** A builder signs each bid at a leaf of its own choosing among those reserved for bids */
export function isBuilderBidLeafIndex(leafIndex: number): boolean {
  const start = XMSS_RESERVED_LEAVES + XMSS_ATTESTATION_LEAVES;
  return start <= leafIndex && leafIndex < start + XMSS_BUILDER_BID_LEAVES;
}

/** The leaf a bid's signature must be at: the one it carries if reserved for bids, otherwise none */
export function getXmssBidLeafIndex(signature: Uint8Array): number {
  const leafIndex = getXmssSignatureLeafIndex(signature);
  return isBuilderBidLeafIndex(leafIndex) ? leafIndex : -1;
}

/** The leaf a signature says it was made at. `verifyXmss` proves it. */
export function getXmssSignatureLeafIndex(signature: Uint8Array): number {
  return new DataView(signature.buffer, signature.byteOffset, 4).getUint32(0, true);
}

/** True only if `signature` is `pubkey`'s over `signingRoot` at `leafIndex` */
export function verifyXmss(
  pubkey: pq.XMSSPubkey,
  leafIndex: number,
  signingRoot: Uint8Array,
  signature: pq.XMSSSignature
): boolean {
  if (signature.length !== XMSS_SIGNATURE_SIZE) return false;
  if (getXmssSignatureLeafIndex(signature) !== leafIndex) return false;
  return verifyXmssSignature(pubkey, signingRoot, signature);
}

/**
 * A request made before the fork names a compressed BLS public key, whose first byte has its top
 * bit set. One made after names 16 zero bytes then a leanXMSS public key.
 */
export function isLegacyPubkey(pubkey: Uint8Array): boolean {
  for (let i = 0; i < XMSS_REQUEST_PREFIX_SIZE; i++) {
    if (pubkey[i] !== 0) return true;
  }
  return false;
}

/** How a deposit or an execution request names a leanXMSS public key */
export function toRequestPubkey(pubkey: pq.XMSSPubkey): Uint8Array {
  const out = new Uint8Array(XMSS_REQUEST_PREFIX_SIZE + pubkey.length);
  out.set(pubkey, XMSS_REQUEST_PREFIX_SIZE);
  return out;
}

/**
 * How the beacon API names a validator's public key. Its public key fields are 48 bytes, so a
 * leanXMSS public key goes in the form requests use.
 */
export function toApiPubkey(pubkey: Uint8Array): Uint8Array {
  return pubkey.length === XMSS_REQUEST_PREFIX_SIZE + 32 ? pubkey : toRequestPubkey(pubkey);
}

/** The leanXMSS public key a request's `pubkey` names, without regard for legacy requests */
export function fromRequestPubkey(pubkey: Uint8Array): pq.XMSSPubkey {
  return pubkey.subarray(XMSS_REQUEST_PREFIX_SIZE);
}

function legacyDigest(pubkey: Uint8Array, domain: number): Uint8Array {
  const input = new Uint8Array(pubkey.length + 1);
  input.set(pubkey);
  input[pubkey.length] = domain;
  return digest(input);
}

/** The leanXMSS public key that a deposit naming `pubkey` is for */
export function computeDepositPubkey(pubkey: Uint8Array): pq.XMSSPubkey {
  return isLegacyPubkey(pubkey) ? legacyDigest(pubkey, LEGACY_XMSS_PUBKEY_DOMAIN) : fromRequestPubkey(pubkey);
}

/** The VRF root of the validator that a deposit creates */
export function computeDepositVrfRoot(pubkey: Uint8Array, signature: Uint8Array): Uint8Array {
  return isLegacyPubkey(pubkey) ? legacyDigest(pubkey, LEGACY_VRF_ROOT_DOMAIN) : signature.subarray(0, 32);
}

/** Checks that `proof` opens the leaf for `slot` under `vrfRoot`, in a tree hashed with Keccak-256 */
export function isValidVrfProof(vrfRoot: Uint8Array, slot: Slot, proof: pq.VRFProof): boolean {
  if (proof.length !== VRF_TREE_DEPTH + 1) return false;
  return isValidNativeVrfProof(vrfRoot, slot, Buffer.concat(proof));
}

/**
 * The aggregators of `committee`, the beacon committee at `slot` for `index`: sampled by effective
 * balance, without duplicates. `epochSeed` is the epoch's seed for `DOMAIN_SELECTION_PROOF`.
 */
export function computeAggregationCommittee(
  epochSeed: Uint8Array,
  slot: Slot,
  index: number,
  committee: Uint32Array,
  effectiveBalanceIncrements: Uint16Array
): ValidatorIndex[] {
  const seedInput = new Uint8Array(48);
  seedInput.set(epochSeed);
  const seedInputView = new DataView(seedInput.buffer);
  seedInputView.setBigUint64(32, BigInt(slot), true);
  seedInputView.setBigUint64(40, BigInt(index), true);
  const pickInput = new Uint8Array(40);
  pickInput.set(digest(seedInput));

  const aggregators: ValidatorIndex[] = [];
  let candidates = committee;
  while (aggregators.length < AGGREGATORS_PER_COMMITTEE && candidates.length > 0) {
    pickInput[32] = aggregators.length;
    const aggregator = computePtcIndices(
      digest(pickInput),
      candidates,
      effectiveBalanceIncrements,
      1,
      MAX_EFFECTIVE_BALANCE_ELECTRA,
      EFFECTIVE_BALANCE_INCREMENT
    )[0];
    aggregators.push(aggregator);
    candidates = candidates.filter((candidate) => candidate !== aggregator);
  }
  return aggregators;
}

/** The aggregation committee of each beacon committee of each slot of `epoch`, whose committees are `committees` */
export function computeAggregationCommitteesForEpoch(
  state: BeaconStateAllForks,
  epoch: Epoch,
  committees: Uint32Array[][],
  effectiveBalanceIncrements: Uint16Array
): pq.AggregationCommittees[] {
  const epochSeed = getSeed(state, epoch, DOMAIN_SELECTION_PROOF);
  const startSlot = computeStartSlotAtEpoch(epoch);
  return committees.map((slotCommittees, slotOffset) =>
    slotCommittees.map((committee, index) =>
      computeAggregationCommittee(epochSeed, startSlot + slotOffset, index, committee, effectiveBalanceIncrements)
    )
  );
}

/**
 * The window of a state at the start of its epoch, as at genesis: the previous epoch has no
 * aggregation committees.
 */
export function initializeAggregationCommitteeWindow(state: CachedBeaconStateAllForks): pq.AggregationCommittees[] {
  const window: pq.AggregationCommittees[] = Array.from({length: SLOTS_PER_EPOCH}, () => []);
  for (let epochOffset = 0; epochOffset <= MIN_SEED_LOOKAHEAD; epochOffset++) {
    const epoch = state.epochCtx.epoch + epochOffset;
    const shuffling =
      state.epochCtx.getShufflingAtEpochOrNull(epoch) ??
      computeEpochShuffling(state, getActiveValidatorIndices(state, epoch), epoch);
    window.push(
      ...computeAggregationCommitteesForEpoch(
        state,
        epoch,
        shuffling.committees,
        state.epochCtx.effectiveBalanceIncrements
      )
    );
  }
  return window;
}

/**
 * The aggregation committee of the beacon committee at `slot` for `index`, from the window of a
 * state at `stateEpoch`. Throws for a slot outside the previous, current and lookahead epochs.
 */
export function getAggregationCommittee(
  window: {getReadonly(index: number): {getReadonly(index: number): {getAll(): ValidatorIndex[]}; length: number}},
  stateEpoch: Epoch,
  slot: Slot,
  index: number
): ValidatorIndex[] {
  const epoch = computeEpochAtSlot(slot);
  if (epoch + 1 < stateEpoch || epoch > stateEpoch + MIN_SEED_LOOKAHEAD) {
    throw Error(`No aggregation committees for epoch ${epoch} in a state at epoch ${stateEpoch}`);
  }
  const committees = window.getReadonly((epoch + 1 - stateEpoch) * SLOTS_PER_EPOCH + (slot % SLOTS_PER_EPOCH));
  if (index >= committees.length) throw Error(`No committee ${index} at slot ${slot}`);
  return committees.getReadonly(index).getAll();
}

type GloasMessageTypes = Pick<
  typeof ssz.gloas,
  | "ExecutionPayloadEnvelope"
  | "SignedExecutionPayloadEnvelope"
  | "ExecutionRequests"
  | "SignedProposerPreferences"
  | "PayloadAttestationMessage"
>;

/**
 * The types of the messages Gloas introduced, at `slot`. Each had one type until pq, whose own
 * differ by their signature and, for an envelope, by its execution requests.
 */
export function getGloasMessageTypes(config: ChainForkConfig, slot: Slot): GloasMessageTypes {
  return (config.getForkName(slot) === ForkName.pq ? ssz.pq : ssz.gloas) as GloasMessageTypes;
}
