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

export type ForkPreLightClient = ForkName.phase0;
export type ForkLightClient = Exclude<ForkName, ForkPreLightClient>;
export const forkLightClient = exclude(forkAll, [ForkName.phase0]);
export function isForkLightClient(fork: ForkName): fork is ForkLightClient {
  return fork !== ForkName.phase0;
}

export type ForkPreExecution = ForkPreLightClient | ForkName.altair;
export type ForkExecution = Exclude<ForkName, ForkPreExecution>;
export const forkExecution = exclude(forkAll, [ForkName.phase0, ForkName.altair]);
export function isForkExecution(fork: ForkName): fork is ForkExecution {
  return isForkLightClient(fork) && fork !== ForkName.altair;
}

export type ForkPreWithdrawals = ForkPreExecution | ForkName.bellatrix;
export type ForkWithdrawals = Exclude<ForkName, ForkPreWithdrawals>;
export const forkWithdrawals = exclude(forkAll, [ForkName.phase0, ForkName.altair, ForkName.bellatrix]);
export function isForkWithdrawals(fork: ForkName): fork is ForkWithdrawals {
  return isForkExecution(fork) && fork !== ForkName.bellatrix;
}

export type ForkPreBlobs = ForkPreWithdrawals | ForkName.capella;
export type ForkBlobs = Exclude<ForkName, ForkPreBlobs>;
export const forkBlobs = exclude(forkAll, [ForkName.phase0, ForkName.altair, ForkName.bellatrix, ForkName.capella]);
export function isForkBlobs(fork: ForkName): fork is ForkBlobs {
  return isForkWithdrawals(fork) && fork !== ForkName.capella;
}

export type ForkPreElectra = ForkPreBlobs | ForkName.deneb;
export type ForkPostElectra = Exclude<ForkName, ForkPreElectra>;
export const forkPostElectra = exclude(forkAll, [
  ForkName.phase0,
  ForkName.altair,
  ForkName.bellatrix,
  ForkName.capella,
  ForkName.deneb,
]);
export function isForkPostElectra(fork: ForkName): fork is ForkPostElectra {
  return isForkBlobs(fork) && fork !== ForkName.deneb;
}
