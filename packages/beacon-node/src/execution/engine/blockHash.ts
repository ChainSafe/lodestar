import {computeExecutionBlockHash as computeExecutionBlockHashNative} from "@lodestar/native/execution-block-hash";
import {ForkPostBellatrix, ForkPostElectra, ForkSeq} from "@lodestar/params";
import {ExecutionPayload, ExecutionRequests, Root, sszTypesFor} from "@lodestar/types";

/**
 * Compute the execution block hash of `payload`: keccak256 of the RLP-encoded execution block header,
 * with the header fields laid out as in execution-specs for the execution fork paired with `fork`.
 *
 * `parentBeaconBlockRoot` is required from deneb and `executionRequests` from electra.
 *
 * Throws if a transaction is empty. It would be a deletion in the transactions trie and not change the hash.
 */
export function computeExecutionBlockHash(
  fork: ForkPostBellatrix,
  payload: ExecutionPayload,
  parentBeaconBlockRoot: Root | null,
  executionRequests: ExecutionRequests | null
): Uint8Array {
  return computeExecutionBlockHashNative(
    ForkSeq[fork],
    sszTypesFor(fork).ExecutionPayload.serialize(payload),
    parentBeaconBlockRoot ?? undefined,
    executionRequests !== null && ForkSeq[fork] >= ForkSeq.electra
      ? sszTypesFor(fork as ForkPostElectra).ExecutionRequests.serialize(executionRequests)
      : undefined
  );
}
