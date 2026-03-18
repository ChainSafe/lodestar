import {PublicKey} from "@chainsafe/blst";
import {BeaconConfig} from "@lodestar/config";
import {ForkSeq} from "@lodestar/params";
import {SignedBeaconBlock, Slot, phase0, ssz} from "@lodestar/types";
import {PubkeyCache} from "../cache/pubkeyCache.js";
import {IBeaconStateView} from "../stateView/interface.js";
import {
  ISignatureSet,
  SignatureSetType,
  computeSigningRoot,
  computeStartSlotAtEpoch,
  convertValidatorIndexToBuilderIndex,
  isBuilderIndex,
  verifySignatureSet,
} from "../util/index.js";

export function verifyVoluntaryExitSignature(
  config: BeaconConfig,
  pubkeyCache: PubkeyCache,
  state: IBeaconStateView,
  signedVoluntaryExit: phase0.SignedVoluntaryExit
): boolean {
  return verifySignatureSet(getVoluntaryExitSignatureSet(config, state, signedVoluntaryExit), pubkeyCache);
}

/**
 * Extract signatures to allow validating all block signatures at once.
 */
export function getVoluntaryExitSignatureSet(
  config: BeaconConfig,
  state: IBeaconStateView,
  signedVoluntaryExit: phase0.SignedVoluntaryExit
): ISignatureSet {
  if (config.getForkSeq(state.slot) >= ForkSeq.gloas && isBuilderVoluntaryExit(signedVoluntaryExit)) {
    return getBuilderVoluntaryExitSignatureSet(config, state, signedVoluntaryExit);
  }

  return getValidatorVoluntaryExitSignatureSet(config, state.slot, signedVoluntaryExit);
}

export function getVoluntaryExitsSignatureSets(
  config: BeaconConfig,
  state: IBeaconStateView,
  signedBlock: SignedBeaconBlock
): ISignatureSet[] {
  return signedBlock.message.body.voluntaryExits.map((voluntaryExit) =>
    getVoluntaryExitSignatureSet(config, state, voluntaryExit)
  );
}

export function getValidatorVoluntaryExitSignatureSet(
  config: BeaconConfig,
  stateSlot: Slot,
  signedVoluntaryExit: phase0.SignedVoluntaryExit
): ISignatureSet {
  const messageSlot = computeStartSlotAtEpoch(signedVoluntaryExit.message.epoch);
  const domain = config.getDomainForVoluntaryExit(stateSlot, messageSlot);

  return {
    type: SignatureSetType.indexed,
    index: signedVoluntaryExit.message.validatorIndex,
    signingRoot: computeSigningRoot(ssz.phase0.VoluntaryExit, signedVoluntaryExit.message, domain),
    signature: signedVoluntaryExit.signature,
  };
}

export function getBuilderVoluntaryExitSignatureSet(
  config: BeaconConfig,
  state: IBeaconStateView,
  signedVoluntaryExit: phase0.SignedVoluntaryExit
): ISignatureSet {
  const messageSlot = computeStartSlotAtEpoch(signedVoluntaryExit.message.epoch);
  const domain = config.getDomainForVoluntaryExit(state.slot, messageSlot);
  const builderIndex = convertValidatorIndexToBuilderIndex(signedVoluntaryExit.message.validatorIndex);
  const builder = state.getBuilder(builderIndex);

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
