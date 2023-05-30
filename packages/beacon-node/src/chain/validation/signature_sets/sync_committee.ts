import {DOMAIN_SYNC_COMMITTEE} from "@lodestar/params";
import {altair, ssz} from "@lodestar/types";
import {
  CachedBeaconStateAllForks,
  computeSigningRoot,
  ISignatureSet,
  SignatureSetType,
} from "@lodestar/state-transition";

export function getSyncCommitteeSignatureSet(
  state: CachedBeaconStateAllForks,
  syncCommittee: altair.SyncCommitteeMessage
): ISignatureSet {
  const domain = state.config.getDomain(state.slot, DOMAIN_SYNC_COMMITTEE, syncCommittee.slot);

  return {
    type: SignatureSetType.single,
    pubkey: state.epochCtx.index2pubkey[syncCommittee.validatorIndex],
    signingRoot: computeSigningRoot(ssz.Root, syncCommittee.beaconBlockRoot, domain),
    signature: syncCommittee.signature,
  };
}
