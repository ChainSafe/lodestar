import deepmerge from "deepmerge";
import {phase0} from "@chainsafe/lodestar-types";
import {isPlainObject} from "@chainsafe/lodestar-utils";
import {RecursivePartial} from "@chainsafe/lodestar-utils";
import {generateEmptyAttestation} from "./attestation";
import {EMPTY_SIGNATURE} from "../../src/constants";

export function generateAggregateAndProof(
  override: RecursivePartial<phase0.AggregateAndProof> = {}
): phase0.AggregateAndProof {
  return deepmerge<phase0.AggregateAndProof, RecursivePartial<phase0.AggregateAndProof>>(
    {
      aggregatorIndex: 0,
      aggregate: generateEmptyAttestation(),
      selectionProof: EMPTY_SIGNATURE,
    },
    override,
    {isMergeableObject: isPlainObject}
  );
}

export function generateSignedAggregateAndProof(
  override: RecursivePartial<phase0.AggregateAndProof> = {}
): phase0.SignedAggregateAndProof {
  return {
    message: generateAggregateAndProof(override),
    signature: EMPTY_SIGNATURE,
  };
}
