import {Result, wrapError} from "../../util/wrapError.js";
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

/** Gossip failure metadata shared by engine results and network handlers. */
export type GossipValidationFailure = {
  status: GossipValidationStatus.Ignore | GossipValidationStatus.Reject;
  /** LodestarError code — drives metrics + facade branching */
  code: string;
  /** best-effort scalar logging context (FFI-friendly); do not depend on specific fields */
  data?: Record<string, string | number>;
  /** TRANSITIONAL: original JS error for rich logs while validators still throw; native leaves undefined */
  error?: Error;
};

export type GossipValidationResult<T> = Result<T, GossipValidationFailure>;

export function accept<T>(value: T): GossipValidationResult<T> {
  return {err: null, result: value};
}

export function ignore(
  code: string,
  data?: Record<string, string | number>,
  error?: Error
): GossipValidationResult<never> {
  return {err: {status: GossipValidationStatus.Ignore, code, data, error}};
}

export function reject(
  code: string,
  data?: Record<string, string | number>,
  error?: Error
): GossipValidationResult<never> {
  return {err: {status: GossipValidationStatus.Reject, code, data, error}};
}

function failureFromGossipActionError(e: GossipActionError<{code: string}>): GossipValidationFailure {
  const status = e.action === GossipAction.REJECT ? GossipValidationStatus.Reject : GossipValidationStatus.Ignore;
  return {status, code: e.type.code, data: e.type as unknown as Record<string, string | number>, error: e};
}

/** Converts gossip validation errors to results; unexpected failures still reject. */
export async function runGossipValidation<T>(fn: () => Promise<T>): Promise<GossipValidationResult<T>> {
  return wrapError(fn, (e) => {
    if (e instanceof GossipActionError) {
      return failureFromGossipActionError(e);
    }
    throw e;
  });
}

/** Converts per-item batch failures, mapping unexpected errors to Ignore. */
export function fromResult<T>(r: Result<T>): GossipValidationResult<T> {
  if (r.err == null) {
    return accept(r.result);
  }
  if (r.err instanceof GossipActionError) {
    return {err: failureFromGossipActionError(r.err)};
  }
  return ignore("UNEXPECTED_ERROR", undefined, r.err);
}
