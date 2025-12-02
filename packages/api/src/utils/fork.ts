import {
  ForkName,
  ForkPostAltair,
  ForkPostBellatrix,
  ForkPostDeneb,
  isForkPostAltair,
  isForkPostBellatrix,
  isForkPostDeneb,
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
