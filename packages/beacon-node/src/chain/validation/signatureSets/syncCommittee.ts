import {BeaconConfig} from "@lodestar/config";
import {DOMAIN_SYNC_COMMITTEE} from "@lodestar/params";
import {ISignatureSet, SignatureSetType, computeSigningRoot} from "@lodestar/state-transition";
import {altair, ssz} from "@lodestar/types";

export function getSyncCommitteeSignatureSet(
  config: BeaconConfig,
  syncCommittee: altair.SyncCommitteeMessage
): ISignatureSet {
  const domain = config.getDomainAtFork(config.getForkName(syncCommittee.slot), DOMAIN_SYNC_COMMITTEE);

  return {
    type: SignatureSetType.indexed,
    index: syncCommittee.validatorIndex,
    signingRoot: computeSigningRoot(ssz.Root, syncCommittee.beaconBlockRoot, domain),
    signature: syncCommittee.signature,
  };
}
