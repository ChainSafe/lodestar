import {computeExecutionBlockHash as computeExecutionBlockHashNative} from "@lodestar/native/execution-block-hash";
import {ForkPostBellatrix, ForkSeq, isForkPostElectra} from "@lodestar/params";
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
  return computeExecutionBlockHashSerialized(
    fork,
    sszTypesFor(fork).ExecutionPayload.serialize(payload),
    parentBeaconBlockRoot,
    executionRequests !== null && isForkPostElectra(fork)
      ? sszTypesFor(fork).ExecutionRequests.serialize(executionRequests)
      : null
  );
}

/**
 * Same as `computeExecutionBlockHash`, from the SSZ serializations of the payload and execution requests of `fork`.
 */
export function computeExecutionBlockHashSerialized(
  fork: ForkPostBellatrix,
  payload: Uint8Array,
  parentBeaconBlockRoot: Root | null,
  executionRequests: Uint8Array | null
): Uint8Array {
  return computeExecutionBlockHashNative(
    ForkSeq[fork],
    payload,
    parentBeaconBlockRoot ?? undefined,
    executionRequests ?? undefined
  );
}
