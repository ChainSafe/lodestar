import {BeaconConfig} from "@lodestar/config";
import {gloas, ssz} from "@lodestar/types";
import {byteArrayEquals, toHex, toRootHex} from "@lodestar/utils";
import {
  type IBeaconStateViewGloas,
  type PubkeyCache,
  computeTimeAtSlot,
  getExecutionPayloadEnvelopeSignatureSet,
} from "@lodestar/state-transition";
import {IBlsVerifier} from "../bls/index.js";

export type VerifyExecutionPayloadEnvelopeOpts = {
  verifyExecutionRequestsRoot?: boolean;
};

/**
 * Verify execution payload envelope fields against the post-block state.
 * Does NOT verify signature (done separately) or call the execution engine.
 *
 * Spec: gloas/fork-choice.md — verify_execution_payload_envelope
 */
export function verifyExecutionPayloadEnvelope(
  config: BeaconConfig,
  state: IBeaconStateViewGloas,
  envelope: gloas.ExecutionPayloadEnvelope,
  opts?: VerifyExecutionPayloadEnvelopeOpts
): void {
  const {verifyExecutionRequestsRoot = true} = opts ?? {};
  const payload = envelope.payload;

  // Compute header root without mutating state
  const headerValue = {...state.latestBlockHeader};
  if (byteArrayEquals(headerValue.stateRoot, ssz.Root.defaultValue())) {
    headerValue.stateRoot = state.hashTreeRoot();
  }
  const headerRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(headerValue);

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
  const bid = state.latestExecutionPayloadBid;
  if (envelope.builderIndex !== bid.builderIndex) {
    throw new Error(
      `Builder index mismatch between envelope and committed bid envelope=${envelope.builderIndex} bid=${bid.builderIndex}`
    );
  }

  if (!byteArrayEquals(bid.prevRandao, payload.prevRandao)) {
    throw new Error(
      `Prev randao mismatch between bid and payload bid=${toHex(bid.prevRandao)} payload=${toHex(payload.prevRandao)}`
    );
  }

  if (Number(bid.gasLimit) !== payload.gasLimit) {
    throw new Error(
      `Gas limit mismatch between payload and bid payload=${payload.gasLimit} bid=${Number(bid.gasLimit)}`
    );
  }

  if (!byteArrayEquals(bid.blockHash, payload.blockHash)) {
    throw new Error(
      `Block hash mismatch between payload and bid payload=${toRootHex(payload.blockHash)} bid=${toRootHex(bid.blockHash)}`
    );
  }

  // Verify execution_requests_root matches bid commitment
  // Can be skipped if already verified during gossip validation
  if (verifyExecutionRequestsRoot) {
    const requestsRoot = ssz.electra.ExecutionRequests.hashTreeRoot(envelope.executionRequests);
    if (!byteArrayEquals(requestsRoot, bid.executionRequestsRoot)) {
      throw new Error(
        `Execution requests root mismatch envelope=${toRootHex(requestsRoot)} bid=${toRootHex(bid.executionRequestsRoot)}`
      );
    }
  }

  // Verify the execution payload is valid
  if (!byteArrayEquals(payload.parentHash, state.latestBlockHash)) {
    throw new Error(
      `Parent hash mismatch between payload and state payload=${toRootHex(payload.parentHash)} state=${toRootHex(state.latestBlockHash)}`
    );
  }

  if (payload.timestamp !== computeTimeAtSlot(config, state.slot, state.genesisTime)) {
    throw new Error(
      `Timestamp mismatch between payload and state payload=${payload.timestamp} state=${computeTimeAtSlot(config, state.slot, state.genesisTime)}`
    );
  }

  // Verify consistency with expected withdrawals
  const payloadWithdrawalsRoot = ssz.capella.Withdrawals.hashTreeRoot(payload.withdrawals);
  const expectedWithdrawalsRoot = ssz.capella.Withdrawals.hashTreeRoot(state.payloadExpectedWithdrawals);
  if (!byteArrayEquals(payloadWithdrawalsRoot, expectedWithdrawalsRoot)) {
    throw new Error(
      `Withdrawals mismatch between payload and expected payload=${toRootHex(payloadWithdrawalsRoot)} expected=${toRootHex(expectedWithdrawalsRoot)}`
    );
  }

  // Execution engine verification (verify_and_notify_new_payload) is done externally
}

/**
 * Verify the BLS signature of an execution payload envelope.
 *
 * Spec: gloas/fork-choice.md — verify_execution_payload_envelope_signature
 */
export async function verifyExecutionPayloadEnvelopeSignature(
  config: BeaconConfig,
  state: IBeaconStateViewGloas,
  pubkeyCache: PubkeyCache,
  signedEnvelope: gloas.SignedExecutionPayloadEnvelope,
  proposerIndex: number,
  bls: IBlsVerifier
): Promise<boolean> {
  const signatureSet = getExecutionPayloadEnvelopeSignatureSet(
    config,
    pubkeyCache,
    state,
    signedEnvelope,
    proposerIndex
  );
  return bls.verifySignatureSets([signatureSet]);
}
