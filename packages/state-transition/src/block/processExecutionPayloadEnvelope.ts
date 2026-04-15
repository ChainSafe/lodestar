import {gloas, ssz} from "@lodestar/types";
import {byteArrayEquals, toHex, toRootHex} from "@lodestar/utils";
import {getExecutionPayloadEnvelopeSignatureSet} from "../signatureSets/executionPayloadEnvelope.js";
import {BeaconStateView} from "../stateView/beaconStateView.js";
import {CachedBeaconStateGloas} from "../types.js";
import {computeTimeAtSlot} from "../util/index.js";
import {verifySignatureSet} from "../util/signatureSets.js";

export type ProcessExecutionPayloadEnvelopeOpts = {
  verifySignature?: boolean;
};

/**
 * Pure verification of execution payload envelope — no state mutation.
 * Payload processing is deferred to the next beacon block via processParentExecutionPayload.
 *
 * This function does not call the execution engine. That must be done separately.
 *
 * Spec: consensus-specs#5094 verify_execution_payload_envelope
 */
export function processExecutionPayloadEnvelope(
  state: CachedBeaconStateGloas,
  signedEnvelope: gloas.SignedExecutionPayloadEnvelope,
  opts?: ProcessExecutionPayloadEnvelopeOpts
): void {
  const {verifySignature = true} = opts ?? {};
  const envelope = signedEnvelope.message;

  if (verifySignature && !verifyExecutionPayloadEnvelopeSignature(state, signedEnvelope)) {
    throw Error(`Execution payload envelope has invalid signature builderIndex=${envelope.builderIndex}`);
  }

  validateExecutionPayloadEnvelope(state, envelope);
}

function validateExecutionPayloadEnvelope(
  state: CachedBeaconStateGloas,
  envelope: gloas.ExecutionPayloadEnvelope
): void {
  const payload = envelope.payload;

  // Cache latest block header state root
  // Note: we read but do NOT mutate state — we compute the header root on a copy
  let headerRoot: Uint8Array;
  if (byteArrayEquals(state.latestBlockHeader.stateRoot, ssz.Root.defaultValue())) {
    // Compute what the header root would be with the state root filled in
    const header = ssz.phase0.BeaconBlockHeader.toViewDU(state.latestBlockHeader.toValue());
    header.stateRoot = state.hashTreeRoot();
    headerRoot = header.hashTreeRoot();
  } else {
    headerRoot = state.latestBlockHeader.hashTreeRoot();
  }

  // Verify consistency with the beacon block
  if (!byteArrayEquals(envelope.beaconBlockRoot, headerRoot)) {
    throw new Error(
      `Envelope's block is not the latest block header envelope=${toRootHex(envelope.beaconBlockRoot)} latestBlockHeader=${toRootHex(headerRoot)}`
    );
  }

  if (payload.slotNumber !== state.slot) {
    throw new Error(`Slot mismatch between payload and state payload=${payload.slotNumber} state=${state.slot}`);
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

  // Verify execution_requests_root matches bid commitment (consensus-specs#5094)
  const requestsRoot = ssz.electra.ExecutionRequests.hashTreeRoot(envelope.executionRequests);
  if (!byteArrayEquals(requestsRoot, committedBid.executionRequestsRoot)) {
    throw new Error(
      `Execution requests root mismatch envelope=${toRootHex(requestsRoot)} committedBid=${toRootHex(committedBid.executionRequestsRoot)}`
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

  // Execution engine verification (verify_and_notify_new_payload) is done externally
}

function verifyExecutionPayloadEnvelopeSignature(
  state: CachedBeaconStateGloas,
  signedEnvelope: gloas.SignedExecutionPayloadEnvelope
): boolean {
  const signatureSet = getExecutionPayloadEnvelopeSignatureSet(
    state.config,
    state.epochCtx.pubkeyCache,
    new BeaconStateView(state),
    signedEnvelope,
    state.latestBlockHeader.proposerIndex
  );
  return verifySignatureSet(signatureSet);
}
