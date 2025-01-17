import {DOMAIN_INCLUSION_LIST_COMMITTEE} from "@lodestar/params";
import {focil, ssz} from "@lodestar/types";

import {CachedBeaconStateAllForks} from "../types.js";
import {ISignatureSet, SignatureSetType, computeSigningRoot} from "../util/index.js";

export function getInclusionListSignatureSet(
  state: CachedBeaconStateAllForks,
  inclusionList: focil.SignedInclusionList
): ISignatureSet {
  const message = inclusionList.message;
  const validatorIndex = message.validatorIndex;
  const pubkey = state.epochCtx.index2pubkey[validatorIndex];
  const domain = state.config.getDomain(state.slot, DOMAIN_INCLUSION_LIST_COMMITTEE, message.slot);

  return {
    type: SignatureSetType.single,
    pubkey,
    signingRoot: computeSigningRoot(ssz.focil.InclusionList, message, domain),
    signature: inclusionList.signature,
  };
}
