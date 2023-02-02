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

export type ForkExecution = Exclude<ForkName, ForkName.phase0 | ForkName.altair>;
export function isForkExecution(fork: ForkName): fork is ForkExecution {
  return fork !== ForkName.phase0 && fork !== ForkName.altair;
}

export type ForkBlobs = Exclude<ForkExecution, ForkName.bellatrix | ForkName.capella>;
export function isForkBlobs(fork: ForkName): fork is ForkBlobs {
  return isForkExecution(fork) && fork !== ForkName.bellatrix && fork !== ForkName.capella;
}
