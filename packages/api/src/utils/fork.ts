import {
  ForkName,
  ForkPostAltair,
  ForkPostBellatrix,
  ForkPostDeneb,
  ForkPostElectra,
  ForkPostGloas,
  ForkPreEip8453,
  isForkPostAltair,
  isForkPostBellatrix,
  isForkPostDeneb,
  isForkPostEip8453,
  isForkPostElectra,
  isForkPostGloas,
} from "@lodestar/params";
import {SSZTypesFor, sszTypesFor} from "@lodestar/types";

export function toForkName(version: string): ForkName {
  // Teku returns fork as UPPERCASE
  version = version.toLowerCase();

  // Un-safe external data, validate version is known ForkName value
  if (!(version in ForkName)) throw Error(`Invalid version ${version}`);

  return version as ForkName;
}

export function getPostAltairForkTypes(fork: ForkName): SSZTypesFor<ForkPostAltair> {
  if (!isForkPostAltair(fork)) {
    throw Error(`Invalid fork=${fork} for post-altair fork types`);
  }

  return sszTypesFor(fork);
}

export function getPostBellatrixForkTypes(fork: ForkName): SSZTypesFor<ForkPostBellatrix> {
  if (!isForkPostBellatrix(fork)) {
    throw Error(`Invalid fork=${fork} for post-bellatrix fork types`);
  }

  return sszTypesFor(fork);
}

export function getPostDenebForkTypes(fork: ForkName): SSZTypesFor<ForkPostDeneb> {
  if (!isForkPostDeneb(fork)) {
    throw Error(`Invalid fork=${fork} for post-deneb fork types`);
  }

  return sszTypesFor(fork);
}

export function getPostElectraForkTypes(fork: ForkName): SSZTypesFor<ForkPostElectra> {
  if (!isForkPostElectra(fork)) {
    throw Error(`Invalid fork=${fork} for post-electra fork types`);
  }

  return sszTypesFor(fork);
}

export function getPostGloasForkTypes(fork: ForkName): SSZTypesFor<ForkPostGloas> {
  if (!isForkPostGloas(fork)) {
    throw Error(`Invalid fork=${fork} for post-gloas fork types`);
  }

  return sszTypesFor(fork);
}

/**
 * SSZ types for the forks that still carry Casper FFG attestations. EIP-8453 (Decoupled Consensus) replaces
 * `AttestationData`, so routes that read `data.slot` or hand attestations to a fork-specific codec only exist before it.
 */
export function getPreEip8453ForkTypes(fork: ForkName): SSZTypesFor<ForkPreEip8453> {
  if (isForkPostEip8453(fork)) {
    throw Error(`Invalid fork=${fork} for pre-eip8453 fork types`);
  }

  return sszTypesFor(fork);
}
