import {BeaconConfig} from "@lodestar/config";
import {DOMAIN_SYNC_COMMITTEE} from "@lodestar/params";
import {
  CachedBeaconStateAllForks,
  ISignatureSet,
  Index2PubkeyCache,
  SignatureSetType,
  computeSigningRoot,
} from "@lodestar/state-transition";
import {altair, ssz} from "@lodestar/types";

export function getSyncCommitteeSignatureSet(
  config: BeaconConfig,
  index2pubkey: Index2PubkeyCache,
  state: CachedBeaconStateAllForks,
  syncCommittee: altair.SyncCommitteeMessage
): ISignatureSet {
  const domain = config.getDomain(state.slot, DOMAIN_SYNC_COMMITTEE, syncCommittee.slot);

  return {
    type: SignatureSetType.single,
    pubkey: index2pubkey[syncCommittee.validatorIndex],
    signingRoot: computeSigningRoot(ssz.Root, syncCommittee.beaconBlockRoot, domain),
    signature: syncCommittee.signature,
  };
}
