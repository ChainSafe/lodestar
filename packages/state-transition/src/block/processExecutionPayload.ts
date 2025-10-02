import {PublicKey, Signature, verify} from "@chainsafe/blst";
import {byteArrayEquals} from "@chainsafe/ssz";
import {DOMAIN_BEACON_BUILDER, ForkName, ForkSeq, isForkPostDeneb} from "@lodestar/params";
import {BeaconBlockBody, BlindedBeaconBlockBody, deneb, gloas, isExecutionPayload, ssz} from "@lodestar/types";
import {toHex, toRootHex} from "@lodestar/utils";
import {CachedBeaconStateBellatrix, CachedBeaconStateCapella, CachedBeaconStateGloas} from "../types.js";
import {
  executionPayloadToPayloadHeader,
  getFullOrBlindedPayloadFromBody,
  isMergeTransitionComplete,
} from "../util/execution.js";
import {computeEpochAtSlot, computeSigningRoot, computeTimeAtSlot, getRandaoMix} from "../util/index.js";
import {BlockExternalData, ExecutionPayloadStatus} from "./externalData.js";

export function processExecutionPayload(
  fork: ForkSeq,
  state: CachedBeaconStateBellatrix | CachedBeaconStateCapella,
  body: BeaconBlockBody | BlindedBeaconBlockBody,
  externalData: Omit<BlockExternalData, "dataAvailabilityStatus">
): void {
  const payload = getFullOrBlindedPayloadFromBody(body);
  const forkName = ForkName[ForkSeq[fork] as ForkName];
  // Verify consistency of the parent hash, block number, base fee per gas and gas limit
  // with respect to the previous execution payload header
  if (isMergeTransitionComplete(state)) {
    const {latestExecutionPayloadHeader} = state;
    if (!byteArrayEquals(payload.parentHash, latestExecutionPayloadHeader.blockHash)) {
      throw Error(
        `Invalid execution payload parentHash ${toRootHex(payload.parentHash)} latest blockHash ${toRootHex(
          latestExecutionPayloadHeader.blockHash
        )}`
      );
    }
  }

  // Verify random
  const expectedRandom = getRandaoMix(state, state.epochCtx.epoch);
  if (!byteArrayEquals(payload.prevRandao, expectedRandom)) {
    throw Error(`Invalid execution payload random ${toHex(payload.prevRandao)} expected=${toHex(expectedRandom)}`);
  }

  // Verify timestamp
  //
  // Note: inlined function in if statement
  // def compute_timestamp_at_slot(state: BeaconState, slot: Slot) -> uint64:
  //   slots_since_genesis = slot - GENESIS_SLOT
  //   return uint64(state.genesis_time + slots_since_genesis * SLOT_DURATION_MS / 1000)
  if (payload.timestamp !== computeTimeAtSlot(state.config, state.slot, state.genesisTime)) {
    throw Error(`Invalid timestamp ${payload.timestamp} genesisTime=${state.genesisTime} slot=${state.slot}`);
  }

  if (isForkPostDeneb(forkName)) {
    const maxBlobsPerBlock = state.config.getMaxBlobsPerBlock(computeEpochAtSlot(state.slot));
    const blobKzgCommitmentsLen = (body as deneb.BeaconBlockBody).blobKzgCommitments?.length ?? 0;
    if (blobKzgCommitmentsLen > maxBlobsPerBlock) {
      throw Error(`blobKzgCommitmentsLen of ${blobKzgCommitmentsLen} exceeds limit=${maxBlobsPerBlock}`);
    }
  }

  // Verify the execution payload is valid
  //
  // if executionEngine is null, executionEngine.onPayload MUST be called after running processBlock to get the
  // correct randao mix. Since executionEngine will be an async call in most cases it is called afterwards to keep
  // the state transition sync
  //
  // Equivalent to `assert executionEngine.notifyNewPayload(payload)`
  if (isExecutionPayload(payload)) {
    switch (externalData.executionPayloadStatus) {
      case ExecutionPayloadStatus.preMerge:
        throw Error("executionPayloadStatus preMerge");
      case ExecutionPayloadStatus.invalid:
        throw Error("Invalid execution payload");
      case ExecutionPayloadStatus.valid:
        break; // ok
    }
  }

  const payloadHeader = isExecutionPayload(payload) ? executionPayloadToPayloadHeader(fork, payload) : payload;

  // TODO Deneb: Types are not happy by default. Since it's a generic type going through ViewDU
  // transformation then into all forks compatible probably some weird intersection incompatibility happens
  state.latestExecutionPayloadHeader = state.config
    .getPostBellatrixForkTypes(state.slot)
    .ExecutionPayloadHeader.toViewDU(payloadHeader) as typeof state.latestExecutionPayloadHeader;
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
