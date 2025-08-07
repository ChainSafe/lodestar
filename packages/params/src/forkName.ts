/**
 * Fork code name in order of occurrence
 */
export enum ForkName {
  phase0 = "phase0",
  altair = "altair",
  bellatrix = "bellatrix",
  capella = "capella",
  deneb = "deneb",
  electra = "electra",
  fulu = "fulu",
}

/**
 * Fork sequence number in order of occurrence
 */
export enum ForkSeq {
  phase0 = 0,
  altair = 1,
  bellatrix = 2,
  capella = 3,
  deneb = 4,
  electra = 5,
  fulu = 6,
}

function exclude<T extends ForkName, U extends T>(coll: T[], val: U[]): Exclude<T, U>[] {
  return coll.filter((f) => !val.includes(f as U)) as Exclude<T, U>[];
}

export function highestFork<F extends ForkName>(forkNames: F[]): F {
  let highest = forkNames[0];

  for (const forkName of forkNames) {
    if (ForkSeq[forkName] > ForkSeq[highest]) {
      highest = forkName;
    }
  }

  return highest;
}

export function lowestFork<F extends ForkName>(forkNames: F[]): F {
  let lowest = forkNames[0];

  for (const forkName of forkNames) {
    if (ForkSeq[forkName] < ForkSeq[lowest]) {
      lowest = forkName;
    }
  }

  return lowest;
}

export type ForkAll = ForkName;
export const forkAll = Object.values(ForkName);

export type ForkPreAltair = ForkName.phase0;
export type ForkPostAltair = Exclude<ForkName, ForkPreAltair>;
export const forkPostAltair = exclude(forkAll, [ForkName.phase0]);
export function isForkPostAltair(fork: ForkName): fork is ForkPostAltair {
  return fork !== ForkName.phase0;
}

export type ForkPreBellatrix = ForkPreAltair | ForkName.altair;
export type ForkPostBellatrix = Exclude<ForkName, ForkPreBellatrix>;
export const forkPostBellatrix = exclude(forkAll, [ForkName.phase0, ForkName.altair]);
export function isForkPostBellatrix(fork: ForkName): fork is ForkPostBellatrix {
  return isForkPostAltair(fork) && fork !== ForkName.altair;
}

export type ForkPreCapella = ForkPreBellatrix | ForkName.bellatrix;
export type ForkPostCapella = Exclude<ForkName, ForkPreCapella>;
export const forkPostCapella = exclude(forkAll, [ForkName.phase0, ForkName.altair, ForkName.bellatrix]);
export function isForkPostCapella(fork: ForkName): fork is ForkPostCapella {
  return isForkPostBellatrix(fork) && fork !== ForkName.bellatrix;
}

export type ForkPreDeneb = ForkPreCapella | ForkName.capella;
export type ForkPostDeneb = Exclude<ForkName, ForkPreDeneb>;
export const forkPostDeneb = exclude(forkAll, [ForkName.phase0, ForkName.altair, ForkName.bellatrix, ForkName.capella]);
export function isForkPostDeneb(fork: ForkName): fork is ForkPostDeneb {
  return isForkPostCapella(fork) && fork !== ForkName.capella;
}

export type ForkPreElectra = ForkPreDeneb | ForkName.deneb;
export type ForkPostElectra = Exclude<ForkName, ForkPreElectra>;
export const forkPostElectra = exclude(forkAll, [
  ForkName.phase0,
  ForkName.altair,
  ForkName.bellatrix,
  ForkName.capella,
  ForkName.deneb,
]);
export function isForkPostElectra(fork: ForkName): fork is ForkPostElectra {
  return isForkPostDeneb(fork) && fork !== ForkName.deneb;
}

export type ForkPreFulu = ForkPreElectra | ForkName.electra;
export type ForkPostFulu = Exclude<ForkName, ForkPreFulu>;
export const forkPostFulu = exclude(forkAll, [
  ForkName.phase0,
  ForkName.altair,
  ForkName.bellatrix,
  ForkName.capella,
  ForkName.deneb,
  ForkName.electra,
]);
export function isForkPostFulu(fork: ForkName): fork is ForkPostFulu {
  return isForkPostElectra(fork) && fork !== ForkName.electra;
}

/*
 * Aliases only exported for backwards compatibility. This will be removed in
 * lodestar v2.0.  The types and guards above should be used in all places as
 * they are more correct than using the "main feature" from a fork.
 */

/**
 * @deprecated Use `ForkPostAltair` instead.
 */
export type ForkLightClient = ForkPostAltair;
/**
 * @deprecated Use `ForkPreBellatrix` instead.
 */
export type ForkPreExecution = ForkPreBellatrix;
/**
 * @deprecated Use `ForkPostBellatrix` instead.
 */
export type ForkExecution = ForkPostBellatrix;
/**
 * @deprecated Use `ForkPreCapella` instead.
 */
export type ForkPreWithdrawals = ForkPreCapella;
/**
 * @deprecated Use `ForkPostCapella` instead.
 */
export type ForkWithdrawals = ForkPostCapella;
/**
 * @deprecated Use `forkPostAltair` instead.
 */
export const forkLightClient = forkPostAltair;
/**
 * @deprecated Use `isForkPostAltair` instead.
 */
export const isForkLightClient = isForkPostAltair;
/**
 * @deprecated Use `forkPostBellatrix` instead.
 */
export const forkExecution = forkPostBellatrix;
/**
 * @deprecated Use `isForkPostBellatrix` instead.
 */
export const isForkExecution = isForkPostBellatrix;
/**
 * @deprecated Use `forkPostCapella` instead.
 */
export const forkWithdrawals = forkPostCapella;
/**
 * @deprecated Use `isForkPostCapella` instead.
 */
export const isForkWithdrawals = isForkPostCapella;
