import {BeaconConfig} from "@lodestar/config";
import {SignedBeaconBlock, Slot, phase0, ssz} from "@lodestar/types";
import {Index2PubkeyCache} from "../cache/pubkeyCache.js";
import {
  ISignatureSet,
  SignatureSetType,
  computeSigningRoot,
  computeStartSlotAtEpoch,
  verifySignatureSet,
} from "../util/index.js";

export function verifyVoluntaryExitSignature(
  config: BeaconConfig,
  index2pubkey: Index2PubkeyCache,
  stateSlot: Slot,
  signedVoluntaryExit: phase0.SignedVoluntaryExit
): boolean {
  return verifySignatureSet(getVoluntaryExitSignatureSet(config, index2pubkey, stateSlot, signedVoluntaryExit));
}

/**
 * Extract signatures to allow validating all block signatures at once
 */
export function getVoluntaryExitSignatureSet(
  config: BeaconConfig,
  index2pubkey: Index2PubkeyCache,
  stateSlot: Slot,
  signedVoluntaryExit: phase0.SignedVoluntaryExit
): ISignatureSet {
  const messageSlot = computeStartSlotAtEpoch(signedVoluntaryExit.message.epoch);
  const domain = config.getDomainForVoluntaryExit(stateSlot, messageSlot);

  return {
    type: SignatureSetType.single,
    pubkey: index2pubkey[signedVoluntaryExit.message.validatorIndex],
    signingRoot: computeSigningRoot(ssz.phase0.VoluntaryExit, signedVoluntaryExit.message, domain),
    signature: signedVoluntaryExit.signature,
  };
}

export function getVoluntaryExitsSignatureSets(
  config: BeaconConfig,
  index2pubkey: Index2PubkeyCache,
  signedBlock: SignedBeaconBlock
): ISignatureSet[] {
  // the getDomain() api requires the state slot as 1st param, however it's the same to block.slot in state-transition
  // and the same epoch when we verify blocks in batch in beacon-node. So we can safely use block.slot here.
  const blockSlot = signedBlock.message.slot;
  return signedBlock.message.body.voluntaryExits.map((voluntaryExit) =>
    getVoluntaryExitSignatureSet(config, index2pubkey, blockSlot, voluntaryExit)
  );
}
