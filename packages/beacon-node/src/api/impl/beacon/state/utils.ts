import {routes} from "@lodestar/api";
import {CheckpointWithHex} from "@lodestar/fork-choice";
import {ForkName, GENESIS_SLOT} from "@lodestar/params";
import {RootHex, Slot} from "@lodestar/types";
import {ApiStateResult, ApiStateResultWithFork, IBeaconEngine} from "../../../../chain/beaconEngine/index.js";
import {ApiError, ValidationError} from "../../errors.js";

export function resolveStateId(
  beaconEngine: IBeaconEngine,
  stateId: routes.beacon.StateId
): RootHex | Slot | CheckpointWithHex {
  if (stateId === "head") {
    return beaconEngine.getHead().stateRoot;
  }

  if (stateId === "genesis") {
    return GENESIS_SLOT;
  }

  if (stateId === "finalized") {
    return beaconEngine.getFinalizedCheckpoint();
  }

  if (stateId === "justified") {
    return beaconEngine.getJustifiedCheckpoint();
  }

  if (typeof stateId === "string" && stateId.startsWith("0x")) {
    return stateId;
  }

  // id must be slot
  const blockSlot = parseInt(String(stateId), 10);
  if (Number.isNaN(blockSlot) && Number.isNaN(blockSlot - 0)) {
    throw new ValidationError(`Invalid block id '${stateId}'`, "blockId");
  }

  return blockSlot;
}

/**
 * Unwrap an engine {@link ApiStateResult}: `null` → 404, `invalid` → the mapped `ApiError`, otherwise the
 * DTO + meta. Keeps HTTP-status mapping in the API layer (the engine stays HTTP-free).
 */
export function unwrapStateResult<T>(
  res: ApiStateResult<T>,
  stateId: routes.beacon.StateId
): {data: T; executionOptimistic: boolean; finalized: boolean; fork?: ForkName} {
  if (res === null) {
    throw new ApiError(404, `State not found for id '${stateId}'`);
  }
  if ("invalid" in res) {
    throw new ApiError(res.invalid.code, res.invalid.message);
  }
  return res;
}

/** {@link unwrapStateResult} for reads whose success branch always carries `fork` (used as `version` meta). */
export function unwrapStateResultWithFork<T>(
  res: ApiStateResultWithFork<T>,
  stateId: routes.beacon.StateId
): {data: T; executionOptimistic: boolean; finalized: boolean; fork: ForkName} {
  if (res === null) {
    throw new ApiError(404, `State not found for id '${stateId}'`);
  }
  if ("invalid" in res) {
    throw new ApiError(res.invalid.code, res.invalid.message);
  }
  return res;
}
