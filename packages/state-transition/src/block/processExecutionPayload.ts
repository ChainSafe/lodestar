import {byteArrayEquals} from "@chainsafe/ssz";
import {BeaconBlockBody, BlindedBeaconBlockBody, deneb, isExecutionPayload} from "@lodestar/types";
import {ForkSeq, MAX_BLOBS_PER_BLOCK} from "@lodestar/params";
import {toHex, toRootHex} from "@lodestar/utils";
import {CachedBeaconStateBellatrix, CachedBeaconStateCapella} from "../types.js";
import {getRandaoMix} from "../util/index.js";
import {
  isMergeTransitionComplete,
  getFullOrBlindedPayloadFromBody,
  executionPayloadToPayloadHeader,
} from "../util/execution.js";
import {BlockExternalData, ExecutionPayloadStatus} from "./externalData.js";

export function processExecutionPayload(
  fork: ForkSeq,
  state: CachedBeaconStateBellatrix | CachedBeaconStateCapella,
  body: BeaconBlockBody | BlindedBeaconBlockBody,
  externalData: Omit<BlockExternalData, "dataAvailableStatus">
): void {
  const payload = getFullOrBlindedPayloadFromBody(body);
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
  //   return uint64(state.genesis_time + slots_since_genesis * SECONDS_PER_SLOT)
  if (payload.timestamp !== state.genesisTime + state.slot * state.config.SECONDS_PER_SLOT) {
    throw Error(`Invalid timestamp ${payload.timestamp} genesisTime=${state.genesisTime} slot=${state.slot}`);
  }

  if (fork >= ForkSeq.deneb) {
    const blobKzgCommitmentsLen = (body as deneb.BeaconBlockBody).blobKzgCommitments?.length ?? 0;
    if (blobKzgCommitmentsLen > MAX_BLOBS_PER_BLOCK) {
      throw Error(`blobKzgCommitmentsLen exceeds limit=${MAX_BLOBS_PER_BLOCK}`);
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
    .getExecutionForkTypes(state.slot)
    .ExecutionPayloadHeader.toViewDU(payloadHeader) as typeof state.latestExecutionPayloadHeader;
}
