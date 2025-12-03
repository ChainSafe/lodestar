import {PublicKey, Signature, verify} from "@chainsafe/blst";
import {byteArrayEquals} from "@chainsafe/ssz";
import {DOMAIN_BEACON_BUILDER, SLOTS_PER_EPOCH, SLOTS_PER_HISTORICAL_ROOT} from "@lodestar/params";
import {gloas, ssz} from "@lodestar/types";
import {toHex, toRootHex} from "@lodestar/utils";
import {CachedBeaconStateGloas} from "../types.ts";
import {computeExitEpochAndUpdateChurn, computeSigningRoot, computeTimeAtSlot} from "../util/index.ts";
import {processConsolidationRequest} from "./processConsolidationRequest.ts";
import {processDepositRequest} from "./processDepositRequest.ts";
import {processWithdrawalRequest} from "./processWithdrawalRequest.ts";

// This function does not call execution engine to verify payload. Need to call it from other place
export function processExecutionPayloadEnvelope(
  state: CachedBeaconStateGloas,
  signedEnvelope: gloas.SignedExecutionPayloadEnvelope,
  verify: boolean
): void {
  const envelope = signedEnvelope.message;
  const payload = envelope.payload;
  const fork = state.config.getForkSeq(envelope.slot);

  if (verify) {
    const builderIndex = envelope.builderIndex;
    const pubkey = state.validators.getReadonly(builderIndex).pubkey;

    if (!verifyExecutionPayloadEnvelopeSignature(state, pubkey, signedEnvelope)) {
      throw new Error("Payload Envelope has invalid signature");
    }
  }

  validateExecutionPayloadEnvelope(state, envelope);

  const requests = envelope.executionRequests;

  for (const deposit of requests.deposits) {
    processDepositRequest(state, deposit);
  }

  for (const withdrawal of requests.withdrawals) {
    processWithdrawalRequest(fork, state, withdrawal);
  }

  for (const consolidation of requests.consolidations) {
    processConsolidationRequest(fork, state, consolidation);
  }

  // Queue the builder payment
  const paymentIndex = SLOTS_PER_EPOCH + (state.slot % SLOTS_PER_EPOCH);
  const payment = state.builderPendingPayments.get(paymentIndex).clone();
  const amount = payment.withdrawal.amount;

  if (amount > 0) {
    const exitQueueEpoch = computeExitEpochAndUpdateChurn(state, BigInt(amount));

    payment.withdrawal.withdrawableEpoch = exitQueueEpoch + state.config.MIN_VALIDATOR_WITHDRAWABILITY_DELAY;
    state.builderPendingWithdrawals.push(payment.withdrawal);
  }

  state.builderPendingPayments.set(paymentIndex, ssz.gloas.BuilderPendingPayment.defaultViewDU());

  // Cache the execution payload hash
  state.executionPayloadAvailability.set(state.slot % SLOTS_PER_HISTORICAL_ROOT, true);
  state.latestBlockHash = payload.blockHash;

  if (verify && !byteArrayEquals(envelope.stateRoot, state.hashTreeRoot())) {
    throw new Error(
      `Envelope's state root does not match state envelope=${toRootHex(envelope.stateRoot)} state=${toRootHex(state.hashTreeRoot())}`
    );
  }
}

function validateExecutionPayloadEnvelope(
  state: CachedBeaconStateGloas,
  envelope: gloas.ExecutionPayloadEnvelope
): void {
  const payload = envelope.payload;

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

  // Verify consistency with the beacon block
  if (envelope.slot !== state.slot) {
    throw new Error(`Slot mismatch between envelope and state envelope=${envelope.slot} state=${state.slot}`);
  }

  const committedBid = state.latestExecutionPayloadBid;
  // Verify consistency with the committed bid
  if (envelope.builderIndex !== committedBid.builderIndex) {
    throw new Error(
      `Builder index mismatch between envelope and committed bid envelope=${envelope.builderIndex} committedBid=${committedBid.builderIndex}`
    );
  }

  // Verify consistency with the committed bid
  const envelopeKzgRoot = ssz.deneb.BlobKzgCommitments.hashTreeRoot(envelope.blobKzgCommitments);
  if (!byteArrayEquals(committedBid.blobKzgCommitmentsRoot, envelopeKzgRoot)) {
    throw new Error(
      `Kzg commitment root mismatch between envelope and committed bid envelope=${toRootHex(envelopeKzgRoot)} committedBid=${toRootHex(committedBid.blobKzgCommitmentsRoot)}`
    );
  }

  // Verify the withdrawals root
  const envelopeWithdrawalsRoot = ssz.capella.Withdrawals.hashTreeRoot(envelope.payload.withdrawals);
  if (!byteArrayEquals(state.latestWithdrawalsRoot, envelopeWithdrawalsRoot)) {
    throw new Error(
      `Withdrawals root mismatch between envelope and latest withdrawals root envelope=${toRootHex(envelopeWithdrawalsRoot)} latestWithdrawalRoot=${toRootHex(state.latestWithdrawalsRoot)}`
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

  // Verify prev_randao matches committed bid
  if (!byteArrayEquals(committedBid.prevRandao, payload.prevRandao)) {
    throw new Error(
      `Prev randao mismatch between committed bid and payload committedBid=${toHex(committedBid.prevRandao)} payload=${toHex(payload.prevRandao)}`
    );
  }

  // Verify timestamp
  if (payload.timestamp !== computeTimeAtSlot(state.config, state.slot, state.genesisTime)) {
    throw new Error(
      `Timestamp mismatch between envelope's payload and state envelope=${payload.timestamp} state=${computeTimeAtSlot(state.config, state.slot, state.genesisTime)}`
    );
  }

  // Verify commitments are under limit
  const maxBlobsPerBlock = state.config.getMaxBlobsPerBlock(state.epochCtx.epoch);
  if (envelope.blobKzgCommitments.length > maxBlobsPerBlock) {
    throw new Error(
      `Kzg commitments exceed limit commitment.length=${envelope.blobKzgCommitments.length} limit=${maxBlobsPerBlock}`
    );
  }

  // Skipped: Verify the execution payload is valid
}

function verifyExecutionPayloadEnvelopeSignature(
  state: CachedBeaconStateGloas,
  pubkey: Uint8Array,
  signedEnvelope: gloas.SignedExecutionPayloadEnvelope
): boolean {
  const domain = state.config.getDomain(state.slot, DOMAIN_BEACON_BUILDER);
  const signingRoot = computeSigningRoot(ssz.gloas.ExecutionPayloadEnvelope, signedEnvelope.message, domain);

  try {
    const publicKey = PublicKey.fromBytes(pubkey);
    const signature = Signature.fromBytes(signedEnvelope.signature, true);

    return verify(signingRoot, publicKey, signature);
  } catch (_e) {
    return false; // Catch all BLS errors: failed key validation, failed signature validation, invalid signature
  }
}
