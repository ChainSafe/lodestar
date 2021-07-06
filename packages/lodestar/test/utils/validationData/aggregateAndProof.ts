import {computeSigningRoot} from "@chainsafe/lodestar-beacon-state-transition";
import {DOMAIN_AGGREGATE_AND_PROOF, DOMAIN_SELECTION_PROOF} from "@chainsafe/lodestar-params";
import {phase0, ssz} from "@chainsafe/lodestar-types";
import {IBeaconChain} from "../../../src/chain";
import {getSecretKeyFromIndexCached} from "@chainsafe/lodestar-beacon-state-transition/test/perf/util";
import {SeenAggregators} from "../../../src/chain/seenCache";
import {signCached} from "../cache";
import {getAttestationValidData, AttestationValidDataOpts} from "./attestation";

export type AggregateAndProofValidDataOpts = AttestationValidDataOpts;

/**
 * Generate a valid gossip SignedAggregateAndProof object. Common logic for unit and perf tests
 */
export function getAggregateAndProofValidData(
  opts: AggregateAndProofValidDataOpts
): {
  chain: IBeaconChain;
  signedAggregateAndProof: phase0.SignedAggregateAndProof;
  validatorIndex: number;
} {
  const state = opts.state;

  const {chain, attestation, validatorIndex} = getAttestationValidData(opts);
  const attSlot = attestation.data.slot;

  const sk = getSecretKeyFromIndexCached(validatorIndex);

  // Get around the 'readonly' Typescript restriction
  (chain as {seenAggregators: IBeaconChain["seenAggregators"]}).seenAggregators = new SeenAggregators();

  const aggregatorIndex = validatorIndex;
  const proofDomain = state.config.getDomain(DOMAIN_SELECTION_PROOF, attSlot);
  const proofSigningRoot = computeSigningRoot(ssz.Slot, attSlot, proofDomain);

  const aggregateAndProof: phase0.AggregateAndProof = {
    aggregatorIndex,
    aggregate: attestation,
    selectionProof: signCached(sk, proofSigningRoot),
  };

  const aggDomain = state.config.getDomain(DOMAIN_AGGREGATE_AND_PROOF, attSlot);
  const aggSigningRoot = computeSigningRoot(ssz.phase0.AggregateAndProof, aggregateAndProof, aggDomain);

  const signedAggregateAndProof: phase0.SignedAggregateAndProof = {
    message: aggregateAndProof,
    signature: signCached(sk, aggSigningRoot),
  };

  return {chain, signedAggregateAndProof, validatorIndex};
}
