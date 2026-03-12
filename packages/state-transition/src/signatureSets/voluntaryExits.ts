import {PublicKey} from "@chainsafe/blst";
import {BeaconConfig} from "@lodestar/config";
import {ForkSeq} from "@lodestar/params";
import {SignedBeaconBlock, phase0, ssz} from "@lodestar/types";
import {CachedBeaconStateAllForks, CachedBeaconStateGloas} from "../types.js";
import {convertValidatorIndexToBuilderIndex, isBuilderIndex} from "../util/gloas.js";
import {
  ISignatureSet,
  SignatureSetType,
  computeSigningRoot,
  computeStartSlotAtEpoch,
  verifySignatureSet,
} from "../util/index.js";

export function verifyVoluntaryExitSignature(
  config: BeaconConfig,
  state: CachedBeaconStateAllForks,
  signedVoluntaryExit: phase0.SignedVoluntaryExit
): boolean {
  return verifySignatureSet(
    getVoluntaryExitSignatureSet(config, state, signedVoluntaryExit),
    state.epochCtx.pubkeyCache
  );
}

/**
 * Extract signatures to allow validating all block signatures at once
 */
export function getVoluntaryExitSignatureSet(
  config: BeaconConfig,
  state: CachedBeaconStateAllForks,
  signedVoluntaryExit: phase0.SignedVoluntaryExit
): ISignatureSet {
  const messageSlot = computeStartSlotAtEpoch(signedVoluntaryExit.message.epoch);
  const domain = config.getDomainForVoluntaryExit(state.slot, messageSlot);
  const signingRoot = computeSigningRoot(ssz.phase0.VoluntaryExit, signedVoluntaryExit.message, domain);

  if (config.getForkSeq(state.slot) >= ForkSeq.gloas && isBuilderIndex(signedVoluntaryExit.message.validatorIndex)) {
    const stateGloas = state as CachedBeaconStateGloas;
    const builderIndex = convertValidatorIndexToBuilderIndex(signedVoluntaryExit.message.validatorIndex);
    const builder = stateGloas.builders.getReadonly(builderIndex);

    return {
      type: SignatureSetType.single,
      pubkey: PublicKey.fromBytes(builder.pubkey),
      signingRoot,
      signature: signedVoluntaryExit.signature,
    };
  }

  return {
    type: SignatureSetType.indexed,
    index: signedVoluntaryExit.message.validatorIndex,
    signingRoot,
    signature: signedVoluntaryExit.signature,
  };
}

export function getVoluntaryExitsSignatureSets(config: BeaconConfig, signedBlock: SignedBeaconBlock): ISignatureSet[] {
  // the getDomain() api requires the state slot as 1st param, however it's the same to block.slot in state-transition
  // and the same epoch when we verify blocks in batch in beacon-node. So we can safely use block.slot here.
  for (let i = 0; i < signedBlock.message.body.voluntaryExits.length; i++) {
    if (
      config.getForkSeq(signedBlock.message.slot) >= ForkSeq.gloas &&
      isBuilderIndex(signedBlock.message.body.voluntaryExits[i].message.validatorIndex)
    ) {
      throw Error("Builder voluntary exits require pre-state verification");
    }
  }

  return signedBlock.message.body.voluntaryExits.map((voluntaryExit) => {
    const messageSlot = computeStartSlotAtEpoch(voluntaryExit.message.epoch);
    const domain = config.getDomainForVoluntaryExit(signedBlock.message.slot, messageSlot);

    return {
      type: SignatureSetType.indexed,
      index: voluntaryExit.message.validatorIndex,
      signingRoot: computeSigningRoot(ssz.phase0.VoluntaryExit, voluntaryExit.message, domain),
      signature: voluntaryExit.signature,
    };
  });
}
