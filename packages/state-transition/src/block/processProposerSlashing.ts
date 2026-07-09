import {type PubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {BeaconConfig} from "@lodestar/config";
import {ForkSeq, SLOTS_PER_EPOCH} from "@lodestar/params";
import {Slot, phase0, ssz} from "@lodestar/types";
import {Validator} from "@lodestar/types/phase0";
import {getProposerSlashingSignatureSets} from "../signatureSets/index.js";
import {CachedBeaconStateAllForks, CachedBeaconStateGloas} from "../types.js";
import {computeEpochAtSlot, isSlashableValidator} from "../util/index.js";
import {verifySignatureSet} from "../util/signatureSets.js";
import {slashValidator} from "./slashValidator.js";

/**
 * Process a ProposerSlashing operation. Initiates the exit of a validator, decreases the balance of the slashed
 * validator and increases the block proposer balance.
 *
 * PERF: Work depends on number of ProposerSlashing per block. On regular networks the average is 0 / block.
 */
export function processProposerSlashing(
  fork: ForkSeq,
  state: CachedBeaconStateAllForks,
  proposerSlashing: phase0.ProposerSlashing,
  verifySignatures = true
): void {
  const proposer = state.validators.getReadonly(proposerSlashing.signedHeader1.message.proposerIndex);
  assertValidProposerSlashing(
    state.config,
    state.epochCtx.pubkeyCache,
    state.slot,
    proposerSlashing,
    proposer,
    verifySignatures
  );

  if (fork >= ForkSeq.gloas) {
    // Remove the BuilderPendingPayment corresponding to this proposal if it is still in the
    // 2-epoch window. Only clear it when the slashed validator is the proposer associated with
    // the payment; otherwise an unrelated same-slot equivocation could grief an honest proposer's
    // payment.
    const slot = Number(proposerSlashing.signedHeader1.message.slot);
    const proposalEpoch = computeEpochAtSlot(slot);
    const currentEpoch = state.epochCtx.epoch;
    const previousEpoch = currentEpoch - 1;

    const paymentIndex =
      proposalEpoch === currentEpoch
        ? SLOTS_PER_EPOCH + (slot % SLOTS_PER_EPOCH)
        : proposalEpoch === previousEpoch
          ? slot % SLOTS_PER_EPOCH
          : undefined;

    if (paymentIndex !== undefined) {
      const builderPendingPayments = (state as CachedBeaconStateGloas).builderPendingPayments;
      const payment = builderPendingPayments.get(paymentIndex);
      if (payment.proposerIndex === proposerSlashing.signedHeader1.message.proposerIndex) {
        builderPendingPayments.set(paymentIndex, ssz.gloas.BuilderPendingPayment.defaultViewDU());
      }
    }
  }

  slashValidator(fork, state, proposerSlashing.signedHeader1.message.proposerIndex);
}

export function assertValidProposerSlashing(
  config: BeaconConfig,
  pubkeyCache: PubkeyCache,
  stateSlot: Slot,
  proposerSlashing: phase0.ProposerSlashing,
  proposer: Validator,
  verifySignatures = true
): void {
  const header1 = proposerSlashing.signedHeader1.message;
  const header2 = proposerSlashing.signedHeader2.message;

  // verify header slots match
  if (header1.slot !== header2.slot) {
    throw new Error(`ProposerSlashing slots do not match: slot1=${header1.slot} slot2=${header2.slot}`);
  }

  // verify header proposer indices match
  if (header1.proposerIndex !== header2.proposerIndex) {
    throw new Error(
      `ProposerSlashing proposer indices do not match: proposerIndex1=${header1.proposerIndex} proposerIndex2=${header2.proposerIndex}`
    );
  }

  // verify headers are different
  if (ssz.phase0.BeaconBlockHeaderBigint.equals(header1, header2)) {
    throw new Error("ProposerSlashing headers are equal");
  }

  // verify the proposer is slashable
  // ideally we would get the proposer from state.validators using proposerIndex but that requires access to state
  // instead of that we pass in the proposer directly from the consumer side
  if (!isSlashableValidator(proposer, computeEpochAtSlot(stateSlot))) {
    throw new Error("ProposerSlashing proposer is not slashable");
  }

  // verify signatures
  if (verifySignatures) {
    const signatureSets = getProposerSlashingSignatureSets(config, stateSlot, proposerSlashing);
    for (let i = 0; i < signatureSets.length; i++) {
      if (!verifySignatureSet(signatureSets[i], pubkeyCache)) {
        throw new Error(`ProposerSlashing header${i + 1} signature invalid`);
      }
    }
  }
}
