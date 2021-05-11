import {allForks, altair} from "@chainsafe/lodestar-types";
import {
  CachedBeaconState,
  computeEpochAtSlot,
  computeSigningRoot,
  getDomain,
  ISignatureSet,
  SignatureSetType,
} from "@chainsafe/lodestar-beacon-state-transition";

export function getSyncCommitteeSignatureSet(
  state: CachedBeaconState<allForks.BeaconState>,
  syncCommittee: altair.SyncCommitteeSignature
): ISignatureSet {
  const {config, epochCtx} = state;
  const currentEpoch = computeEpochAtSlot(config, state.slot);
  const domain = getDomain(config, state, config.params.DOMAIN_SYNC_COMMITTEE, currentEpoch);

  return {
    type: SignatureSetType.single,
    pubkey: epochCtx.index2pubkey[syncCommittee.validatorIndex],
    signingRoot: computeSigningRoot(config, config.types.phase0.Root, syncCommittee.beaconBlockRoot, domain),
    signature: syncCommittee.signature.valueOf() as Uint8Array,
  };
}
