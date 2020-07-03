import {verifyAggregate} from "@chainsafe/bls";
import {BeaconState, IndexedAttestation} from "@chainsafe/lodestar-types";

import {DomainType} from "../../constants";
import {computeSigningRoot, getDomain} from "../../util";
import {EpochContext} from "../util";


export function isValidIndexedAttestation(
  epochCtx: EpochContext,
  state: BeaconState,
  indexedAttestation: IndexedAttestation,
  verifySignature = true,
): boolean {
  const config = epochCtx.config;
  const {MAX_VALIDATORS_PER_COMMITTEE} = config.params;
  const indices = Array.from(indexedAttestation.attestingIndices);

  // verify max number of indices
  if (!(indices.length > 0 && indices.length <= MAX_VALIDATORS_PER_COMMITTEE)) {
    return false;
  }
  // verify indices are sorted and unique
  if (!config.types.CommitteeIndices.equals(
    indices,
    [...(new Set(indices)).values()].sort((a, b) => a - b))
  ) {
    return false;
  }
  // verify aggregate signature
  if (!verifySignature) {
    return true;
  }
  const pubkeys = indices.map((i) => epochCtx.index2pubkey[i]);
  const domain = getDomain(config, state, DomainType.BEACON_ATTESTER, indexedAttestation.data.target.epoch);
  const signingRoot = computeSigningRoot(config, config.types.AttestationData, indexedAttestation.data, domain);
  return verifyAggregate(
    pubkeys,
    signingRoot,
    indexedAttestation.signature.valueOf() as Uint8Array,
  );
}
