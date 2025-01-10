import {DOMAIN_IL_COMMITTEE} from "@lodestar/params";
import {focil, ssz} from "@lodestar/types";

import {ISignatureSet, SignatureSetType, computeSigningRoot} from "../util/index.js";
import { CachedBeaconStateAllForks } from "../types.js";

export function getInclusionListSignatureSet(
  state: CachedBeaconStateAllForks,
  inclusionList: focil.SignedInclusionlist,
): ISignatureSet {

  const message = inclusionList.message;
  const validatorIndex  = message.validatorIndex;
  const pubkey = state.epochCtx.index2pubkey[validatorIndex];
  const domain = state.config.getDomain(state.slot, DOMAIN_IL_COMMITTEE, message.slot);

  return {
    type: SignatureSetType.single,
    pubkey,
    signingRoot: computeSigningRoot(ssz.focil.InclusionList, message, domain),
    signature: inclusionList.signature,
  };
}
