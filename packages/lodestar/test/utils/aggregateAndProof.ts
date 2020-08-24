import {AggregateAndProof, SignedAggregateAndProof} from "@chainsafe/lodestar-types";
import {generateEmptyAttestation} from "./attestation";
import {EMPTY_SIGNATURE} from "../../src/constants";
import {DeepPartial} from "./misc";
import deepmerge from "deepmerge";
import {isPlainObject} from "@chainsafe/lodestar-utils";

export function generateAggregateAndProof(override: DeepPartial<AggregateAndProof> = {}): AggregateAndProof {
  return deepmerge<AggregateAndProof, DeepPartial<AggregateAndProof>>(
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
  override: DeepPartial<AggregateAndProof> = {}
): SignedAggregateAndProof {
  return {
    message: generateAggregateAndProof(override),
    signature: EMPTY_SIGNATURE,
  };
}
