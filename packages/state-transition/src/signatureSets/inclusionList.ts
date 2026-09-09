import {BeaconConfig} from "@lodestar/config";
import {DOMAIN_INCLUSION_LIST_COMMITTEE} from "@lodestar/params";
import {Slot, heze, ssz} from "@lodestar/types";
import {ISignatureSet, SignatureSetType, computeSigningRoot} from "../util/index.js";

export function getInclusionListSignatureSet(
  config: BeaconConfig,
  stateSlot: Slot,
  signedInclusionList: heze.SignedInclusionList
): ISignatureSet {
  const message = signedInclusionList.message;
  const domain = config.getDomain(stateSlot, DOMAIN_INCLUSION_LIST_COMMITTEE, message.slot);

  return {
    type: SignatureSetType.indexed,
    index: message.validatorIndex,
    signingRoot: computeSigningRoot(ssz.heze.InclusionList, message, domain),
    signature: signedInclusionList.signature,
  };
}
