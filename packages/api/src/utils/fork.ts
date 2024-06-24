import {
  ForkBlobs,
  ForkExecution,
  ForkLightClient,
  ForkName,
  isForkBlobs,
  isForkExecution,
  isForkLightClient,
} from "@lodestar/params";
import {SSZTypesFor, ssz, sszTypesFor} from "@lodestar/types";

export function toForkName(version: string): ForkName {
  // Teku returns fork as UPPERCASE
  version = version.toLowerCase();

  // Un-safe external data, validate version is known ForkName value
  if (!(version in ForkName)) throw Error(`Invalid version ${version}`);

  return version as ForkName;
}

export function getLightClientForkTypes(fork: ForkName): SSZTypesFor<ForkLightClient> {
  if (!isForkLightClient(fork)) {
    throw Error(`Invalid fork=${fork} for lightclient fork types`);
  }

  return sszTypesFor(fork);
}

export function getExecutionForkTypes(fork: ForkName): SSZTypesFor<ForkExecution> {
  if (!isForkExecution(fork)) {
    throw Error(`Invalid fork=${fork} for execution fork types`);
  }

  return sszTypesFor(fork);
}

export function getBlobsForkTypes(fork: ForkName): SSZTypesFor<ForkBlobs> {
  if (!isForkBlobs(fork)) {
    throw Error(`Invalid fork=${fork} for blobs fork types`);
  }

  return sszTypesFor(fork);
}
