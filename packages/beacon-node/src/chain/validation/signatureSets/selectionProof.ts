import {PublicKey} from "@chainsafe/blst";
import {BeaconConfig} from "@lodestar/config";
import {DOMAIN_SELECTION_PROOF} from "@lodestar/params";
import {ISignatureSet, computeSigningRoot, createSingleSignatureSetFromComponents} from "@lodestar/state-transition";
import {Slot, phase0, ssz} from "@lodestar/types";

export function getSelectionProofSigningRoot(config: BeaconConfig, slot: Slot): Uint8Array {
  // previously, we call `const selectionProofDomain = config.getDomain(state.slot, DOMAIN_SELECTION_PROOF, slot)`
  // at fork boundary, it's required to dial to target epoch https://github.com/ChainSafe/lodestar/blob/v1.11.3/packages/beacon-node/src/chain/validation/attestation.ts#L573
  // instead of that, just use the fork of slot in the attestation data
  const fork = config.getForkName(slot);
  const selectionProofDomain = config.getDomainAtFork(fork, DOMAIN_SELECTION_PROOF);
  return computeSigningRoot(ssz.Slot, slot, selectionProofDomain);
}

export function getSelectionProofSignatureSet(
  config: BeaconConfig,
  slot: Slot,
  aggregator: PublicKey,
  aggregateAndProof: phase0.SignedAggregateAndProof
): ISignatureSet {
  return createSingleSignatureSetFromComponents(
    aggregator,
    getSelectionProofSigningRoot(config, slot),
    aggregateAndProof.message.selectionProof
  );
}
