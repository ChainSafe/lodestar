import {BLSPubkey, Bytes32, Validator} from "@chainsafe/lodestar-types/phase0";
import {ObjectLike, readonlyEntries} from "@chainsafe/ssz";

// A "flat" validator is a concrete `Validator`
// For intermediate computation, the TreeBacked representation slows things down, so a regular object is used instead.

export function createFlat<T = ObjectLike>(value: T): T {
  const flat = {} as Record<string, T[keyof T]>;
  for (const [k, v] of readonlyEntries(value)) {
    // eslint-disable-next-line @typescript-eslint/ban-types
    flat[k as string] = ((v as unknown) as object).valueOf() as T[keyof T];
  }
  return (flat as unknown) as T;
}

export function createValidatorFlat(v: Validator): Validator {
  return {
    pubkey: v.pubkey.valueOf() as BLSPubkey,
    withdrawalCredentials: v.withdrawalCredentials.valueOf() as Bytes32,
    effectiveBalance: v.effectiveBalance,
    slashed: v.slashed,
    activationEligibilityEpoch: v.activationEligibilityEpoch,
    activationEpoch: v.activationEpoch,
    exitEpoch: v.exitEpoch,
    withdrawableEpoch: v.withdrawableEpoch,
  };
}
