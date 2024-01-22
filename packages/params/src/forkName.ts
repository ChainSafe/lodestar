/**
 * Fork code name in order of occurrence
 */
export enum ForkName {
  phase0 = "phase0",
  altair = "altair",
  bellatrix = "bellatrix",
  capella = "capella",
  deneb = "deneb",
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
}

export type ForkPreLightClient = ForkName.phase0;
export type ForkLightClient = Exclude<ForkName, ForkPreLightClient>;
export function isForkLightClient(fork: ForkName): fork is ForkLightClient {
  return fork !== ForkName.phase0;
}

export type ForkPreExecution = ForkPreLightClient | ForkName.altair;
export type ForkExecution = Exclude<ForkName, ForkPreExecution>;
export function isForkExecution(fork: ForkName): fork is ForkExecution {
  return isForkLightClient(fork) && fork !== ForkName.altair;
}

export type ForkPreWithdrawals = ForkPreExecution | ForkName.bellatrix;
export type ForkWithdrawals = Exclude<ForkName, ForkPreWithdrawals>;
export function isForkWithdrawals(fork: ForkName): fork is ForkWithdrawals {
  return isForkExecution(fork) && fork !== ForkName.bellatrix;
}

export type ForkPreBlobs = ForkPreWithdrawals | ForkName.capella;
export type ForkBlobs = Exclude<ForkName, ForkPreBlobs>;
export function isForkBlobs(fork: ForkName): fork is ForkBlobs {
  return isForkWithdrawals(fork) && fork !== ForkName.capella;
}
