import {BeaconConfig} from "@lodestar/config";
import {DOMAIN_INCLUSION_LIST_COMMITTEE} from "@lodestar/params";
import {Slot, heze, ssz} from "@lodestar/types";
import {ISignatureSet, SignatureSetType, computeSigningRoot} from "../util/index.js";

export function getInclusionListSignatureSet(
  config: BeaconConfig,
  stateSlot: Slot,
  inclusionList: heze.SignedInclusionList
): ISignatureSet {
  const message = inclusionList.message;
  const domain = config.getDomain(stateSlot, DOMAIN_INCLUSION_LIST_COMMITTEE, message.slot);

  return {
    type: SignatureSetType.indexed,
    index: message.validatorIndex,
    signingRoot: computeSigningRoot(ssz.heze.InclusionList, message, domain),
    signature: inclusionList.signature,
  };
}
