export enum BlsImplementation {
  blst = "blst",
  lodestarZ = "lodestar-z",
}

const BLS_IMPLEMENTATION_ENV = "LODESTAR_BLS_IMPLEMENTATION";

export function getBlsImplementation(): BlsImplementation {
  const implementation = typeof process === "undefined" ? undefined : process.env[BLS_IMPLEMENTATION_ENV];
  if (implementation === undefined || implementation === BlsImplementation.blst) {
    return BlsImplementation.blst;
  }
  if (implementation === BlsImplementation.lodestarZ) {
    return BlsImplementation.lodestarZ;
  }

  throw Error(`Unknown Lodestar BLS implementation '${implementation}'`);
}
