import deepmerge from "deepmerge";
import {phase0} from "@lodestar/types";
import {isPlainObject} from "@lodestar/utils";
import {RecursivePartial} from "@lodestar/utils";
import {EMPTY_SIGNATURE} from "../../src/constants/index.js";
import {generateEmptyAttestation} from "./attestation.js";

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
