import {BeaconConfig} from "@lodestar/config";
import {DOMAIN_SYNC_COMMITTEE} from "@lodestar/params";
import {
  CachedBeaconStateAllForks,
  ISignatureSet,
  SignatureSetType,
  computeSigningRoot,
} from "@lodestar/state-transition";
import {altair, ssz} from "@lodestar/types";

export function getSyncCommitteeSignatureSet(
  config: BeaconConfig,
  state: CachedBeaconStateAllForks,
  syncCommittee: altair.SyncCommitteeMessage
): ISignatureSet {
  const domain = config.getDomain(state.slot, DOMAIN_SYNC_COMMITTEE, syncCommittee.slot);

  return {
    type: SignatureSetType.indexed,
    index: syncCommittee.validatorIndex,
    signingRoot: computeSigningRoot(ssz.Root, syncCommittee.beaconBlockRoot, domain),
    signature: syncCommittee.signature,
  };
}
