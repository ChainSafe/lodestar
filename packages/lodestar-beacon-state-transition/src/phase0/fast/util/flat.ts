import {readOnlyEntries} from "@chainsafe/ssz";
import {phase0} from "@chainsafe/lodestar-types";

// A "flat" validator is a concrete `Validator`
// For intermediate computation, the TreeBacked representation slows things down, so a regular object is used instead.

/**
 * Convert a Validator (most likely with a tree-backing)
 * into a "flat" validator
 */
export function createIFlatValidator(v: phase0.Validator): phase0.Validator {
  return (readOnlyEntries(v).reduce((flat, [k, v]) => {
    flat[k] = v;
    return flat;
  }, {} as Record<string, phase0.Validator[keyof phase0.Validator]>) as unknown) as phase0.Validator;
}

export function createFlat<T = unknown>(v: T): T {
  return (readOnlyEntries(v).reduce((flat, [k, v]) => {
    flat[k] = v;
    return flat;
  }, {} as Record<string, T[keyof T]>) as unknown) as T;
}
