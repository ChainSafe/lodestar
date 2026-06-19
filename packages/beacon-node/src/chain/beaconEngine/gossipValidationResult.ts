import {Result} from "../../util/wrapError.js";
import {GossipAction, GossipActionError} from "../errors/gossipValidation.js";

/**
 * 3-way discriminant — maps 1:1 to libp2p `TopicValidatorResult`. Plain data, no class, no `instanceof`,
 * so a native (Zig) engine can return it across FFI instead of throwing JS error objects.
 */
export enum GossipValidationStatus {
  Accept = "accept",
  Ignore = "ignore",
  Reject = "reject",
}

/** Shared failure arm (ignore/reject). The facade branches on `code`/`status` only — never on `error`. */
export type GossipValidationFailure = {
  status: GossipValidationStatus.Ignore | GossipValidationStatus.Reject;
  /** LodestarError code — drives metrics + facade branching */
  code: string;
  /** best-effort scalar logging context (FFI-friendly); do not depend on specific fields */
  data?: Record<string, string | number>;
  /** TRANSITIONAL: original JS error for rich logs while validators still throw; native leaves undefined */
  error?: Error;
};

/** Value-bearing result — the engine seam + facade inner helpers (`validateBeaconBlock`, …) use this. */
export type GossipValidationResult<T> = {status: GossipValidationStatus.Accept; value: T} | GossipValidationFailure;

/**
 * Slim verdict — the handler → verdict-mapper boundary. No `value`: the mapper only needs `status`
 * (+ `code` for metrics, `error` for logs). Shares the failure arm with `GossipValidationResult`, so a
 * handler holding a `GossipValidationResult<T>` on its failure branch can `return` it as a verdict with no
 * conversion, and `accept(undefined)` is assignable to the verdict's accept arm.
 */
export type GossipValidationVerdict = {status: GossipValidationStatus.Accept} | GossipValidationFailure;

export function accept<T>(value: T): GossipValidationResult<T> {
  return {status: GossipValidationStatus.Accept, value};
}

export function ignore(
  code: string,
  data?: Record<string, string | number>,
  error?: Error
): GossipValidationResult<never> {
  return {status: GossipValidationStatus.Ignore, code, data, error};
}

export function reject(
  code: string,
  data?: Record<string, string | number>,
  error?: Error
): GossipValidationResult<never> {
  return {status: GossipValidationStatus.Reject, code, data, error};
}

function failureFromGossipActionError(e: GossipActionError<{code: string}>): GossipValidationFailure {
  const status = e.action === GossipAction.REJECT ? GossipValidationStatus.Reject : GossipValidationStatus.Ignore;
  return {status, code: e.type.code, data: e.type as unknown as Record<string, string | number>, error: e};
}

/**
 * JS adapter — wraps a throwing validator and converts a caught `GossipActionError` into a result;
 * rethrows anything else (truly unexpected). Called INSIDE each `BeaconEngine.validateGossip*`/`validateApi*`
 * method — the facade never calls it, and the native engine builds the result struct directly.
 */
export async function runGossipValidation<T>(fn: () => Promise<T>): Promise<GossipValidationResult<T>> {
  try {
    return accept(await fn());
  } catch (e) {
    if (e instanceof GossipActionError) {
      return failureFromGossipActionError(e);
    }
    throw e;
  }
}

/**
 * Batch adapter — the batch validator already returns `Result<T>[]` (caught internally, never throws out).
 * Convert each item to a `GossipValidationResult` so the batch is FFI-safe too (a `Result`'s `.err` is a
 * live JS Error, which a native engine cannot produce).
 */
export function fromResult<T>(r: Result<T>): GossipValidationResult<T> {
  if (r.err == null) {
    return accept(r.result);
  }
  if (r.err instanceof GossipActionError) {
    return failureFromGossipActionError(r.err);
  }
  return ignore("UNEXPECTED_ERROR", undefined, r.err);
}
