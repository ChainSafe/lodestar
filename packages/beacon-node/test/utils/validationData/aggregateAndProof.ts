import {computeSigningRoot} from "@lodestar/state-transition";
import {DOMAIN_AGGREGATE_AND_PROOF, DOMAIN_SELECTION_PROOF} from "@lodestar/params";
import {phase0, ssz} from "@lodestar/types";
import {getSecretKeyFromIndexCached} from "../../../../state-transition/test/perf/util.js";
import {IBeaconChain} from "../../../src/chain/index.js";
import {SeenAggregators} from "../../../src/chain/seenCache/index.js";
import {signCached} from "../cache.js";
import {getAttestationValidData, AttestationValidDataOpts} from "./attestation.js";

export type AggregateAndProofValidDataOpts = AttestationValidDataOpts;

/**
 * Generate a valid gossip SignedAggregateAndProof object. Common logic for unit and perf tests
 */
export function getAggregateAndProofValidData(opts: AggregateAndProofValidDataOpts): {
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
  const proofDomain = state.config.getDomain(state.slot, DOMAIN_SELECTION_PROOF, attSlot);
  const proofSigningRoot = computeSigningRoot(ssz.Slot, attSlot, proofDomain);

  const aggregateAndProof: phase0.AggregateAndProof = {
    aggregatorIndex,
    aggregate: attestation,
    selectionProof: signCached(sk, proofSigningRoot),
  };

  const aggDomain = state.config.getDomain(state.slot, DOMAIN_AGGREGATE_AND_PROOF, attSlot);
  const aggSigningRoot = computeSigningRoot(ssz.phase0.AggregateAndProof, aggregateAndProof, aggDomain);

  const signedAggregateAndProof: phase0.SignedAggregateAndProof = {
    message: aggregateAndProof,
    signature: signCached(sk, aggSigningRoot),
  };

  return {chain, signedAggregateAndProof, validatorIndex};
}
