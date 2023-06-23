import {DOMAIN_VOLUNTARY_EXIT, ForkName} from "@lodestar/params";
import {allForks, phase0, ssz} from "@lodestar/types";
import {
  computeSigningRoot,
  computeStartSlotAtEpoch,
  ISignatureSet,
  SignatureSetType,
  verifySignatureSet,
} from "../util/index.js";
import {CachedBeaconStateAllForks} from "../types.js";

export function verifyVoluntaryExitSignature(
  state: CachedBeaconStateAllForks,
  signedVoluntaryExit: phase0.SignedVoluntaryExit
): boolean {
  return verifySignatureSet(getVoluntaryExitSignatureSet(state, signedVoluntaryExit));
}

/**
 * Extract signatures to allow validating all block signatures at once
 */
export function getVoluntaryExitSignatureSet(
  state: CachedBeaconStateAllForks,
  signedVoluntaryExit: phase0.SignedVoluntaryExit
): ISignatureSet {
  const {epochCtx} = state;
  const slot = computeStartSlotAtEpoch(signedVoluntaryExit.message.epoch);
  const denebSlot = computeStartSlotAtEpoch(state.config.DENEB_FORK_EPOCH);

  // Deneb onwards the domain fork is fixed to Deneb
  //
  // note that previously signed domain for e.g. capella domain sigs will no more be valid on deneb
  // generally the signatures stay valid across one fork boundary
  const domain =
    state.slot < denebSlot
      ? state.config.getDomain(state.slot, DOMAIN_VOLUNTARY_EXIT, slot)
      : state.config.getDomainAtFork(ForkName.deneb, DOMAIN_VOLUNTARY_EXIT);

  return {
    type: SignatureSetType.single,
    pubkey: epochCtx.index2pubkey[signedVoluntaryExit.message.validatorIndex],
    signingRoot: computeSigningRoot(ssz.phase0.VoluntaryExit, signedVoluntaryExit.message, domain),
    signature: signedVoluntaryExit.signature,
  };
}

export function getVoluntaryExitsSignatureSets(
  state: CachedBeaconStateAllForks,
  signedBlock: allForks.SignedBeaconBlock
): ISignatureSet[] {
  return signedBlock.message.body.voluntaryExits.map((voluntaryExit) =>
    getVoluntaryExitSignatureSet(state, voluntaryExit)
  );
}
