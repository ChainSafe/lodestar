import {AggregateAndProof} from "@chainsafe/eth2.0-types";
import {generateEmptyAttestation} from "./attestation";
import {EMPTY_SIGNATURE} from "../../src/constants";

export function generateAggregateAndProof(override: Partial<AggregateAndProof> = {}): AggregateAndProof {
  return {
    aggregatorIndex: 0,
    aggregate: generateEmptyAttestation(),
    selectionProof: EMPTY_SIGNATURE,
    ...override
  };
}