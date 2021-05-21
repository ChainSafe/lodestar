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
  const {config} = state;
  const msgEpoch = computeEpochAtSlot(config, syncCommittee.slot);
  const domain = getDomain(config, state, config.params.DOMAIN_SYNC_COMMITTEE, msgEpoch);

  return {
    type: SignatureSetType.single,
    pubkey: state.epochCtx.index2pubkey[syncCommittee.validatorIndex],
    signingRoot: computeSigningRoot(config, config.types.Root, syncCommittee.beaconBlockRoot, domain),
    signature: syncCommittee.signature.valueOf() as Uint8Array,
  };
}
