import type {PublicKey} from "@chainsafe/bls/types";
import {DOMAIN_AGGREGATE_AND_PROOF} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {Epoch, phase0} from "@lodestar/types";
import {
  computeSigningRoot,
  computeStartSlotAtEpoch,
  createSingleSignatureSetFromComponents,
  ISignatureSet,
} from "@lodestar/state-transition";
import {BeaconConfig} from "@lodestar/config";

export function getAggregateAndProofSigningRoot(
  config: BeaconConfig,
  epoch: Epoch,
  aggregateAndProof: phase0.SignedAggregateAndProof
): Uint8Array {
  // previously, we call `const aggregatorDomain = state.config.getDomain(state.slot, DOMAIN_AGGREGATE_AND_PROOF, slot);`
  // at fork boundary, it's required to dial to target epoch https://github.com/ChainSafe/lodestar/blob/v1.11.3/packages/beacon-node/src/chain/validation/attestation.ts#L573
  // instead of that, just use the fork of slot in the attestation data
  const slot = computeStartSlotAtEpoch(epoch);
  const fork = config.getForkName(slot);
  const aggregatorDomain = config.getDomainAtFork(fork, DOMAIN_AGGREGATE_AND_PROOF);
  return computeSigningRoot(ssz.phase0.AggregateAndProof, aggregateAndProof.message, aggregatorDomain);
}

export function getAggregateAndProofSignatureSet(
  config: BeaconConfig,
  epoch: Epoch,
  aggregator: PublicKey,
  aggregateAndProof: phase0.SignedAggregateAndProof
): ISignatureSet {
  return createSingleSignatureSetFromComponents(
    aggregator,
    getAggregateAndProofSigningRoot(config, epoch, aggregateAndProof),
    aggregateAndProof.signature
  );
}
