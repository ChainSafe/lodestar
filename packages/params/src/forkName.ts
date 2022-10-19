/**
 * Fork code name in order of occurance
 */
export enum ForkName {
  phase0 = "phase0",
  altair = "altair",
  bellatrix = "bellatrix",
  capella = "capella",
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export const AllForks = [ForkName.phase0, ForkName.altair, ForkName.bellatrix, ForkName.capella] as const;
export type AllFork = typeof AllForks[number];

// eslint-disable-next-line @typescript-eslint/naming-convention
export const ExecutionForks = [ForkName.bellatrix, ForkName.capella] as const;
export type ExecutionFork = typeof ExecutionForks[number];

// eslint-disable-next-line @typescript-eslint/naming-convention
export const ForkGroups = [AllForks, ExecutionForks] as const;
export type ForkGroup = typeof ForkGroups[number];

/**
 * Fork sequence number inorder of occurance
 */
export enum ForkSeq {
  phase0 = 0,
  altair = 1,
  bellatrix = 2,
  capella = 3,
}
