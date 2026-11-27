import {DOMAIN_AGGREGATE_AND_PROOF, DOMAIN_SELECTION_PROOF} from "@lodestar/params";
import {computeSigningRoot, isAggregatorFromCommitteeLength} from "@lodestar/state-transition";
import {getSecretKeyFromIndexCached} from "@lodestar/state-transition/test-utils";
import {phase0, ssz} from "@lodestar/types";
import {IBeaconChain} from "../../../src/chain/index.js";
import {SeenAggregators} from "../../../src/chain/seenCache/index.js";
import {signCached} from "../cache.js";
import {AttestationValidDataOpts, getAttestationValidData} from "./attestation.js";

export type AggregateAndProofValidDataOpts = AttestationValidDataOpts;

/**
 * Generate a valid gossip SignedAggregateAndProof object. Common logic for unit and perf tests
 */
export function getAggregateAndProofValidData(opts: AggregateAndProofValidDataOpts): {
  chain: IBeaconChain;
  signedAggregateAndProof: phase0.SignedAggregateAndProof;
  validatorIndex: number;
  bitIndex: number;
} {
  const state = opts.state;
  const attSlot = opts.attSlot ?? opts.currentSlot ?? 100;
  const attIndex = opts.attIndex ?? 0;
  const committee = state.epochCtx.getBeaconCommittee(attSlot, attIndex);
  const proofDomain = state.config.getDomain(state.slot, DOMAIN_SELECTION_PROOF, attSlot);
  const proofSigningRoot = computeSigningRoot(ssz.Slot, attSlot, proofDomain);
  const requestedBitIndex = opts.bitIndex ?? 0;
  let bitIndex: number | undefined;

  for (let offset = 0; offset < committee.length; offset++) {
    const candidateBitIndex = (requestedBitIndex + offset) % committee.length;
    const candidateSk = getSecretKeyFromIndexCached(committee[candidateBitIndex]);
    if (isAggregatorFromCommitteeLength(committee.length, signCached(candidateSk, proofSigningRoot))) {
      bitIndex = candidateBitIndex;
      break;
    }
  }
  if (bitIndex === undefined) throw Error("No aggregator found in committee");

  const {chain, attestation, validatorIndex} = getAttestationValidData({...opts, bitIndex});
  const sk = getSecretKeyFromIndexCached(validatorIndex);

  // Get around the 'readonly' Typescript restriction
  (chain as {seenAggregators: IBeaconChain["seenAggregators"]}).seenAggregators = new SeenAggregators();

  const aggregatorIndex = validatorIndex;

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

  return {chain, signedAggregateAndProof, validatorIndex, bitIndex};
}
