import {ExecutionStatus} from "@lodestar/fork-choice";
import {RootHex} from "@lodestar/types";
import type {ForkchoiceUpdateError} from "../../../execution/engine/interface.js";
import type {BeaconChain} from "../../chain.js";

/**
 * Engine API spec: when EL responds INVALID to `engine_forkchoiceUpdated`, the CL must
 * mark the offending head and its ancestors back to (but not including) `latestValidHash`
 * as INVALID in fork choice and recompute the head. Without this, the CL's tree never
 * abandons the bad branch — every slot it re-fires the same FCU, EL keeps responding
 * INVALID, and the node stays wedged at the same head while the network advances.
 *
 * `validateLatestHash` walks up from `invalidateFromParentBlockRoot` (the invalid block
 * itself, despite the name) marking ancestors invalid until reaching the LVH, then
 * marks all descendants invalid in a second pass and recomputes scores.
 */
export function invalidateForkchoiceHeadFromFcuInvalid(
  chain: BeaconChain,
  headBlockRoot: RootHex,
  headBlockHash: RootHex,
  e: ForkchoiceUpdateError
): void {
  const latestValidHash = e.type.latestValidHash;
  chain.logger.warn(
    "Invalidating head after FCU INVALID response",
    {
      headBlockRoot,
      headBlockHash,
      latestValidHash: latestValidHash ?? "null",
      validationError: e.type.validationError ?? "",
    },
    e
  );

  try {
    chain.forkChoice.validateLatestHash({
      executionStatus: ExecutionStatus.Invalid,
      latestValidExecHash: latestValidHash,
      invalidateFromParentBlockRoot: headBlockRoot,
      invalidateFromParentBlockHash: headBlockHash,
    });
  } catch (err) {
    chain.logger.error(
      "Failed to invalidate head after FCU INVALID response",
      {headBlockRoot, headBlockHash, latestValidHash: latestValidHash ?? "null"},
      err as Error
    );
  }
}
