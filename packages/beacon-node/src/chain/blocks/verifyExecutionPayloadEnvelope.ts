import {BeaconConfig} from "@lodestar/config";
import {
  type IBeaconStateViewGloas,
  type PubkeyCache,
  computeTimeAtSlot,
  getExecutionPayloadEnvelopeSignatureSet,
} from "@lodestar/state-transition";
import {gloas, ssz} from "@lodestar/types";
import {byteArrayEquals, toHex, toRootHex} from "@lodestar/utils";
import {IBlsVerifier} from "../bls/index.js";

export type VerifyExecutionPayloadEnvelopeOpts = {
  verifyExecutionRequestsRoot?: boolean;
};

/**
 * Verify execution payload envelope fields against the post-block state.
 *
 * Signature verification and the execution engine call (`verify_and_notify_new_payload`) are
 * performed outside this function, see `verifyExecutionPayloadEnvelopeSignature` and
 * `importExecutionPayload` which run both in parallel with this check.
 *
 * Spec: https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.6/specs/gloas/fork-choice.md#new-verify_execution_payload_envelope
 */
export function verifyExecutionPayloadEnvelope(
  config: BeaconConfig,
  state: IBeaconStateViewGloas,
  envelope: gloas.ExecutionPayloadEnvelope,
  opts?: VerifyExecutionPayloadEnvelopeOpts
): void {
  const {verifyExecutionRequestsRoot = true} = opts ?? {};
  const payload = envelope.payload;

  // Verify consistency with the beacon block.
  // Compute header root on a clone of latestBlockHeader to avoid mutating state.
  const headerValue = ssz.phase0.BeaconBlockHeader.clone(state.latestBlockHeader);
  if (byteArrayEquals(headerValue.stateRoot, ssz.Root.defaultValue())) {
    headerValue.stateRoot = state.hashTreeRoot();
  }
  const headerRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(headerValue);
  if (!byteArrayEquals(envelope.beaconBlockRoot, headerRoot)) {
    throw new Error(
      `Envelope's block is not the latest block header envelope=${toRootHex(envelope.beaconBlockRoot)} latestBlockHeader=${toRootHex(headerRoot)}`
    );
  }
  if (!byteArrayEquals(envelope.parentBeaconBlockRoot, state.latestBlockHeader.parentRoot)) {
    throw new Error(
      `Envelope's parent_beacon_block_root mismatch envelope=${toRootHex(envelope.parentBeaconBlockRoot)} state=${toRootHex(state.latestBlockHeader.parentRoot)}`
    );
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
  // Verify execution_requests_root matches bid commitment.
  // Can be skipped if already verified during gossip validation.
  if (verifyExecutionRequestsRoot) {
    const requestsRoot = ssz.electra.ExecutionRequests.hashTreeRoot(envelope.executionRequests);
    if (!byteArrayEquals(requestsRoot, bid.executionRequestsRoot)) {
      throw new Error(
        `Execution requests root mismatch envelope=${toRootHex(requestsRoot)} bid=${toRootHex(bid.executionRequestsRoot)}`
      );
    }
  }

  // should not use state.slot, it does not work for skipped slot checkpoint sync
  const blockSlot = state.latestBlockHeader.slot;
  if (payload.slotNumber !== blockSlot) {
    throw new Error(
      `Slot mismatch between payload and latest block header payload=${payload.slotNumber} latestBlockHeader=${blockSlot}`
    );
  }
  if (!byteArrayEquals(payload.parentHash, state.latestBlockHash)) {
    throw new Error(
      `Parent hash mismatch between payload and state payload=${toRootHex(payload.parentHash)} state=${toRootHex(state.latestBlockHash)}`
    );
  }
  const expectedTimestamp = computeTimeAtSlot(config, blockSlot, state.genesisTime);
  if (payload.timestamp !== expectedTimestamp) {
    throw new Error(
      `Timestamp mismatch between payload and state payload=${payload.timestamp} state=${expectedTimestamp}`
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

  // Execution engine verification (verify_and_notify_new_payload) is done externally by the caller
}

/**
 * Verify the BLS signature of an execution payload envelope.
 *
 * Spec: https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.6/specs/gloas/fork-choice.md#new-verify_execution_payload_envelope_signature
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
