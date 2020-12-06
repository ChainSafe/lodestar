import {AggregateAndProof, SignedAggregateAndProof} from "@chainsafe/lodestar-types";
import {generateEmptyAttestation} from "./attestation";
import {EMPTY_SIGNATURE} from "../../src/constants";
import deepmerge from "deepmerge";
import {isPlainObject} from "@chainsafe/lodestar-utils";
import {RecursivePartial} from "@chainsafe/lodestar-cli/src/util";

export function generateAggregateAndProof(override: RecursivePartial<AggregateAndProof> = {}): AggregateAndProof {
  return deepmerge<AggregateAndProof, RecursivePartial<AggregateAndProof>>(
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
  override: RecursivePartial<AggregateAndProof> = {}
): SignedAggregateAndProof {
  return {
    message: generateAggregateAndProof(override),
    signature: EMPTY_SIGNATURE,
  };
}
