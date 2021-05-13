import {allForks, altair} from "@chainsafe/lodestar-types";
import {
  CachedBeaconState,
  computeSigningRoot,
  ISignatureSet,
  SignatureSetType,
} from "@chainsafe/lodestar-beacon-state-transition";

export function getSyncCommitteeSignatureSet(
  state: CachedBeaconState<allForks.BeaconState>,
  syncCommittee: altair.SyncCommitteeSignature
): ISignatureSet {
  const {config} = state;
  const domain = state.getDomain(config.params.DOMAIN_SYNC_COMMITTEE, syncCommittee.slot);

  return {
    type: SignatureSetType.single,
    pubkey: state.epochCtx.index2pubkey[syncCommittee.validatorIndex],
    signingRoot: computeSigningRoot(config, config.types.phase0.Root, syncCommittee.beaconBlockRoot, domain),
    signature: syncCommittee.signature.valueOf() as Uint8Array,
  };
}
