/**
 * Fork code name in order of occurrence
 */
export enum ForkName {
  phase0 = "phase0",
  altair = "altair",
  bellatrix = "bellatrix",
  capella = "capella",
  deneb = "deneb",
  verge = "verge",
}

/**
 * Fork sequence number in order of occurrence
 */
export enum ForkSeq {
  phase0 = 0,
  altair = 1,
  bellatrix = 2,
  capella = 3,
  // Verge is scheduled after capella for now
  verge = 4,
  deneb = 5,
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

export type ForkPreVerge = ForkPreWithdrawals | ForkName.capella;
export type ForkVerge = Exclude<ForkName, ForkPreVerge>;
export function isForkVerge(fork: ForkName): fork is ForkVerge {
  return isForkWithdrawals(fork) && fork !== ForkName.capella;
}

export type ForkPreBlobs = ForkPreVerge | ForkName.verge;
export type ForkBlobs = Exclude<ForkName, ForkPreBlobs>;
export function isForkBlobs(fork: ForkName): fork is ForkBlobs {
  return isForkVerge(fork) && fork !== ForkName.verge;
}
