import {ForkName, isForkBlobs, isForkExecution, isForkLightClient} from "@lodestar/params";
import {allForks, ssz} from "@lodestar/types";

export function toForkName(version: string): ForkName {
  // Teku returns fork as UPPERCASE
  version = version.toLowerCase();

  // Un-safe external data, validate version is known ForkName value
  if (!(version in ForkName)) throw Error(`Invalid version ${version}`);

  return version as ForkName;
}

export function getLightClientForkTypes(fork: ForkName): allForks.AllForksLightClientSSZTypes {
  if (!isForkLightClient(fork)) {
    throw Error(`Invalid fork=${fork} for lightclient fork types`);
  }
  return ssz.allForksLightClient[fork];
}

export function getExecutionForkTypes(fork: ForkName): allForks.AllForksExecutionSSZTypes {
  if (!isForkExecution(fork)) {
    throw Error(`Invalid fork=${fork} for execution fork types`);
  }
  return ssz.allForksExecution[fork];
}

export function getBlindedForkTypes(fork: ForkName): allForks.AllForksBlindedSSZTypes {
  if (!isForkExecution(fork)) {
    throw Error(`Invalid fork=${fork} for blinded fork types`);
  }
  return ssz.allForksBlinded[fork] as allForks.AllForksBlindedSSZTypes;
}

export function getBlobsForkTypes(fork: ForkName): allForks.AllForksBlobsSSZTypes {
  if (!isForkBlobs(fork)) {
    throw Error(`Invalid fork=${fork} for blobs fork types`);
  }
  return ssz.allForksBlobs[fork];
}
