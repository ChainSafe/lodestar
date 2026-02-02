import {BeaconConfig} from "@lodestar/config";
import {DOMAIN_AGGREGATE_AND_PROOF, ForkSeq} from "@lodestar/params";
import {ISignatureSet, SignatureSetType, computeSigningRoot, computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {Epoch, SignedAggregateAndProof, ValidatorIndex, ssz} from "@lodestar/types";

export function getAggregateAndProofSigningRoot(
  config: BeaconConfig,
  epoch: Epoch,
  aggregateAndProof: SignedAggregateAndProof
): Uint8Array {
  // previously, we call `const aggregatorDomain = config.getDomain(state.slot, DOMAIN_AGGREGATE_AND_PROOF, slot);`
  // at fork boundary, it's required to dial to target epoch https://github.com/ChainSafe/lodestar/blob/v1.11.3/packages/beacon-node/src/chain/validation/attestation.ts#L573
  // instead of that, just use the fork of slot in the attestation data
  const slot = computeStartSlotAtEpoch(epoch);
  const fork = config.getForkName(slot);
  const aggregatorDomain = config.getDomainAtFork(fork, DOMAIN_AGGREGATE_AND_PROOF);
  const sszType = ForkSeq[fork] >= ForkSeq.electra ? ssz.electra.AggregateAndProof : ssz.phase0.AggregateAndProof;
  return computeSigningRoot(sszType, aggregateAndProof.message, aggregatorDomain);
}

export function getAggregateAndProofSignatureSet(
  config: BeaconConfig,
  epoch: Epoch,
  aggregatorIndex: ValidatorIndex,
  aggregateAndProof: SignedAggregateAndProof
): ISignatureSet {
  return {
    type: SignatureSetType.indexed,
    index: aggregatorIndex,
    signingRoot: getAggregateAndProofSigningRoot(config, epoch, aggregateAndProof),
    signature: aggregateAndProof.signature,
  };
}
