import {DOMAIN_SYNC_COMMITTEE} from "@chainsafe/lodestar-params";
import {altair, ssz} from "@chainsafe/lodestar-types";
import {
  CachedBeaconStateAllForks,
  computeSigningRoot,
  ISignatureSet,
  SignatureSetType,
} from "@chainsafe/lodestar-beacon-state-transition";

export function getSyncCommitteeSignatureSet(
  state: CachedBeaconStateAllForks,
  syncCommittee: altair.SyncCommitteeMessage
): ISignatureSet {
  const domain = state.config.getDomain(DOMAIN_SYNC_COMMITTEE, syncCommittee.slot);

  return {
    type: SignatureSetType.single,
    pubkey: state.epochCtx.index2pubkey[syncCommittee.validatorIndex],
    signingRoot: computeSigningRoot(ssz.Root, syncCommittee.beaconBlockRoot, domain),
    signature: syncCommittee.signature.valueOf() as Uint8Array,
  };
}
