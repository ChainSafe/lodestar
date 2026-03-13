import {SLOTS_PER_EPOCH, SLOTS_PER_HISTORICAL_ROOT} from "@lodestar/params";
import {gloas, ssz} from "@lodestar/types";
import {byteArrayEquals, toHex, toRootHex} from "@lodestar/utils";
import {getExecutionPayloadEnvelopeSignatureSet} from "../signatureSets/executionPayloadEnvelope.js";
import {CachedBeaconStateGloas} from "../types.js";
import {computeTimeAtSlot} from "../util/index.js";
import {verifySignatureSet} from "../util/signatureSets.js";
import {processConsolidationRequest} from "./processConsolidationRequest.js";
import {processDepositRequest} from "./processDepositRequest.js";
import {processWithdrawalRequest} from "./processWithdrawalRequest.js";

export type ProcessExecutionPayloadEnvelopeOpts = {
  verifySignature?: boolean;
  verifyStateRoot?: boolean;
  dontTransferCache?: boolean;
};

// Unlike other block processing functions which mutate state in-place, this function
// clones the state and returns the post-state, similar to stateTransition().
// This function does not call execution engine to verify payload. Need to call it from other place.
export function processExecutionPayloadEnvelope(
  state: CachedBeaconStateGloas,
  signedEnvelope: gloas.SignedExecutionPayloadEnvelope,
  opts?: ProcessExecutionPayloadEnvelopeOpts
): CachedBeaconStateGloas {
  const {verifySignature = true, verifyStateRoot = true} = opts ?? {};
  const envelope = signedEnvelope.message;
  const payload = envelope.payload;
  const fork = state.config.getForkSeq(envelope.slot);

  if (verifySignature && !verifyExecutionPayloadEnvelopeSignature(state, signedEnvelope)) {
    throw Error(`Execution payload envelope has invalid signature builderIndex=${envelope.builderIndex}`);
  }

  // .clone() before mutating state, similar to stateTransition()
  const postState = state.clone(opts?.dontTransferCache) as CachedBeaconStateGloas;

  validateExecutionPayloadEnvelope(postState, envelope);

  const requests = envelope.executionRequests;

  for (const deposit of requests.deposits) {
    processDepositRequest(fork, postState, deposit);
  }

  for (const withdrawal of requests.withdrawals) {
    processWithdrawalRequest(fork, postState, withdrawal);
  }

  for (const consolidation of requests.consolidations) {
    processConsolidationRequest(postState, consolidation);
  }

  // Queue the builder payment
  const paymentIndex = SLOTS_PER_EPOCH + (postState.slot % SLOTS_PER_EPOCH);
  const payment = postState.builderPendingPayments.get(paymentIndex).clone();
  const amount = payment.withdrawal.amount;

  if (amount > 0) {
    postState.builderPendingWithdrawals.push(payment.withdrawal);
  }

  postState.builderPendingPayments.set(paymentIndex, ssz.gloas.BuilderPendingPayment.defaultViewDU());

  // Cache the execution payload hash
  postState.executionPayloadAvailability.set(postState.slot % SLOTS_PER_HISTORICAL_ROOT, true);
  postState.latestBlockHash = payload.blockHash;

  postState.commit();

  if (verifyStateRoot && !byteArrayEquals(envelope.stateRoot, postState.hashTreeRoot())) {
    throw new Error(
      `Envelope's state root does not match state envelope=${toRootHex(envelope.stateRoot)} state=${toRootHex(postState.hashTreeRoot())}`
    );
  }

  return postState;
}

function validateExecutionPayloadEnvelope(
  state: CachedBeaconStateGloas,
  envelope: gloas.ExecutionPayloadEnvelope
): void {
  const payload = envelope.payload;

  // Cache latest block header state root
  if (byteArrayEquals(state.latestBlockHeader.stateRoot, ssz.Root.defaultValue())) {
    const previousStateRoot = state.hashTreeRoot();
    state.latestBlockHeader.stateRoot = previousStateRoot;
  }

  // Verify consistency with the beacon block
  if (!byteArrayEquals(envelope.beaconBlockRoot, state.latestBlockHeader.hashTreeRoot())) {
    throw new Error(
      `Envelope's block is not the latest block header envelope=${toRootHex(envelope.beaconBlockRoot)} latestBlockHeader=${toRootHex(state.latestBlockHeader.hashTreeRoot())}`
    );
  }

  if (envelope.slot !== state.slot) {
    throw new Error(`Slot mismatch between envelope and state envelope=${envelope.slot} state=${state.slot}`);
  }

  // Verify consistency with the committed bid
  const committedBid = state.latestExecutionPayloadBid;
  if (envelope.builderIndex !== committedBid.builderIndex) {
    throw new Error(
      `Builder index mismatch between envelope and committed bid envelope=${envelope.builderIndex} committedBid=${committedBid.builderIndex}`
    );
  }

  if (!byteArrayEquals(committedBid.prevRandao, payload.prevRandao)) {
    throw new Error(
      `Prev randao mismatch between committed bid and payload committedBid=${toHex(committedBid.prevRandao)} payload=${toHex(payload.prevRandao)}`
    );
  }

  // Verify consistency with expected withdrawals
  const payloadWithdrawalsRoot = ssz.capella.Withdrawals.hashTreeRoot(payload.withdrawals);
  const expectedWithdrawalsRoot = state.payloadExpectedWithdrawals.hashTreeRoot();
  if (!byteArrayEquals(payloadWithdrawalsRoot, expectedWithdrawalsRoot)) {
    throw new Error(
      `Withdrawals mismatch between payload and expected withdrawals payload=${toRootHex(payloadWithdrawalsRoot)} expected=${toRootHex(expectedWithdrawalsRoot)}`
    );
  }

  // Verify the gas_limit
  if (Number(committedBid.gasLimit) !== payload.gasLimit) {
    throw new Error(
      `Gas limit mismatch between envelope's payload and committed bid envelope=${payload.gasLimit} committedBid=${Number(committedBid.gasLimit)}`
    );
  }

  // Verify the block hash
  if (!byteArrayEquals(committedBid.blockHash, payload.blockHash)) {
    throw new Error(
      `Block hash mismatch between envelope's payload and committed bid envelope=${toRootHex(payload.blockHash)} committedBid=${toRootHex(committedBid.blockHash)}`
    );
  }

  // Verify consistency of the parent hash with respect to the previous execution payload
  if (!byteArrayEquals(payload.parentHash, state.latestBlockHash)) {
    throw new Error(
      `Parent hash mismatch between envelope's payload and state envelope=${toRootHex(payload.parentHash)} state=${toRootHex(state.latestBlockHash)}`
    );
  }

  // Verify timestamp
  if (payload.timestamp !== computeTimeAtSlot(state.config, state.slot, state.genesisTime)) {
    throw new Error(
      `Timestamp mismatch between envelope's payload and state envelope=${payload.timestamp} state=${computeTimeAtSlot(state.config, state.slot, state.genesisTime)}`
    );
  }

  // Skipped: Verify the execution payload is valid
}

function verifyExecutionPayloadEnvelopeSignature(
  state: CachedBeaconStateGloas,
  signedEnvelope: gloas.SignedExecutionPayloadEnvelope
): boolean {
  const signatureSet = getExecutionPayloadEnvelopeSignatureSet(
    state.config,
    state,
    signedEnvelope,
    state.latestBlockHeader.proposerIndex
  );
  return verifySignatureSet(signatureSet);
}
