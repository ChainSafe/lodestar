import {PublicKey} from "@chainsafe/blst";
import {BeaconConfig} from "@lodestar/config";
import {SignedBeaconBlock, phase0, ssz} from "@lodestar/types";
import {PubkeyCache} from "../cache/pubkeyCache.js";
import {CachedBeaconStateAllForks} from "../types.js";
import {
  ISignatureSet,
  SignatureSetType,
  computeSigningRoot,
  computeStartSlotAtEpoch,
  convertValidatorIndexToBuilderIndex,
  isBuilderIndex,
  isGloasCachedStateType,
  verifySignatureSet,
} from "../util/index.js";

export function verifyVoluntaryExitSignature(
  config: BeaconConfig,
  pubkeyCache: PubkeyCache,
  state: CachedBeaconStateAllForks,
  signedVoluntaryExit: phase0.SignedVoluntaryExit
): boolean {
  return verifySignatureSet(getVoluntaryExitSignatureSet(config, state, signedVoluntaryExit), pubkeyCache);
}

/**
 * Extract signatures to allow validating all block signatures at once
 */
export function getVoluntaryExitSignatureSet(
  config: BeaconConfig,
  state: CachedBeaconStateAllForks,
  signedVoluntaryExit: phase0.SignedVoluntaryExit
): ISignatureSet {
  if (isGloasCachedStateType(state) && isBuilderVoluntaryExit(signedVoluntaryExit)) {
    return getBuilderVoluntaryExitSignatureSet(config, state, signedVoluntaryExit);
  }

  return getValidatorVoluntaryExitSignatureSet(config, state, signedVoluntaryExit);
}

export function getVoluntaryExitsSignatureSets(
  config: BeaconConfig,
  state: CachedBeaconStateAllForks,
  signedBlock: SignedBeaconBlock
): ISignatureSet[] {
  return signedBlock.message.body.voluntaryExits.map((voluntaryExit) =>
    getVoluntaryExitSignatureSet(config, state, voluntaryExit)
  );
}

export function getValidatorVoluntaryExitSignatureSet(
  config: BeaconConfig,
  state: CachedBeaconStateAllForks,
  signedVoluntaryExit: phase0.SignedVoluntaryExit
): ISignatureSet {
  const messageSlot = computeStartSlotAtEpoch(signedVoluntaryExit.message.epoch);
  const domain = config.getDomainForVoluntaryExit(state.slot, messageSlot);

  return {
    type: SignatureSetType.indexed,
    index: signedVoluntaryExit.message.validatorIndex,
    signingRoot: computeSigningRoot(ssz.phase0.VoluntaryExit, signedVoluntaryExit.message, domain),
    signature: signedVoluntaryExit.signature,
  };
}

export function getBuilderVoluntaryExitSignatureSet(
  config: BeaconConfig,
  state: CachedBeaconStateAllForks,
  signedVoluntaryExit: phase0.SignedVoluntaryExit
): ISignatureSet {
  if (!isGloasCachedStateType(state)) {
    throw Error("Invalid state for builder voluntary exit");
  }

  const messageSlot = computeStartSlotAtEpoch(signedVoluntaryExit.message.epoch);
  const domain = config.getDomainForVoluntaryExit(state.slot, messageSlot);
  const builderIndex = convertValidatorIndexToBuilderIndex(signedVoluntaryExit.message.validatorIndex);
  const builder = state.builders.getReadonly(builderIndex);

  return {
    type: SignatureSetType.single,
    pubkey: PublicKey.fromBytes(builder.pubkey),
    signingRoot: computeSigningRoot(ssz.phase0.VoluntaryExit, signedVoluntaryExit.message, domain),
    signature: signedVoluntaryExit.signature,
  };
}

export function isBuilderVoluntaryExit(signedVoluntaryExit: phase0.SignedVoluntaryExit): boolean {
  return isBuilderIndex(signedVoluntaryExit.message.validatorIndex);
}
