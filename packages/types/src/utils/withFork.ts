import {
  ForkName,
  ForkPostAltair,
  ForkPostBellatrix,
  ForkPostCapella,
  ForkPostDeneb,
  ForkPostElectra,
  ForkPostFulu,
  ForkPostGloas,
  ForkPostHeze,
  isForkPostAltair,
  isForkPostBellatrix,
  isForkPostCapella,
  isForkPostDeneb,
  isForkPostElectra,
  isForkPostFulu,
  isForkPostGloas,
  isForkPostHeze,
} from "@lodestar/params";
import {TypeKey, WithFork} from "../types.js";

/**
 * Pair a value with its fork at the point where the fork is known, typically where the value is deserialized.
 * `key` only drives type inference so that `fork` and `value` are checked against each other when `fork` is a
 * single fork, and so that callers do not have to spell out both type parameters.
 */
export function withFork<K extends TypeKey, F extends ForkName>(
  _key: K,
  fork: F,
  value: WithFork<K, F>["value"]
): WithFork<K, F> {
  return {fork, value} as WithFork<K, F>;
}

export function isWithForkPostAltair<K extends TypeKey>(data: WithFork<K>): data is WithFork<K, ForkPostAltair> {
  return isForkPostAltair(data.fork);
}

export function isWithForkPostBellatrix<K extends TypeKey>(data: WithFork<K>): data is WithFork<K, ForkPostBellatrix> {
  return isForkPostBellatrix(data.fork);
}

export function isWithForkPostCapella<K extends TypeKey>(data: WithFork<K>): data is WithFork<K, ForkPostCapella> {
  return isForkPostCapella(data.fork);
}

export function isWithForkPostDeneb<K extends TypeKey>(data: WithFork<K>): data is WithFork<K, ForkPostDeneb> {
  return isForkPostDeneb(data.fork);
}

export function isWithForkPostElectra<K extends TypeKey>(data: WithFork<K>): data is WithFork<K, ForkPostElectra> {
  return isForkPostElectra(data.fork);
}

export function isWithForkPostFulu<K extends TypeKey>(data: WithFork<K>): data is WithFork<K, ForkPostFulu> {
  return isForkPostFulu(data.fork);
}

export function isWithForkPostGloas<K extends TypeKey>(data: WithFork<K>): data is WithFork<K, ForkPostGloas> {
  return isForkPostGloas(data.fork);
}

export function isWithForkPostHeze<K extends TypeKey>(data: WithFork<K>): data is WithFork<K, ForkPostHeze> {
  return isForkPostHeze(data.fork);
}
