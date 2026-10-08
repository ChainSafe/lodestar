import {describe, expect, it} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {FAR_FUTURE_EPOCH, ForkName, ForkSeq, MAX_EFFECTIVE_BALANCE, SLOTS_PER_EPOCH} from "@lodestar/params";
import {gloas, ssz} from "@lodestar/types";
import {processAttesterSlashing} from "../../../src/block/processAttesterSlashing.js";
import {processProposerSlashing} from "../../../src/block/processProposerSlashing.js";
import {slashValidator} from "../../../src/block/slashValidator.js";
import {createCachedBeaconState} from "../../../src/index.js";
import {BeaconStateGloas, CachedBeaconStateGloas} from "../../../src/types.js";
import {generateState} from "../../utils/state.js";
import {generateValidators} from "../../utils/validator.js";

const proposerIndex = 3;
const otherProposerIndex = 4;
const previousEpochPaymentIndex = 2;
const currentEpochPaymentIndex = SLOTS_PER_EPOCH + 1;
const otherPaymentIndex = SLOTS_PER_EPOCH + 2;

function payment(proposer: number, amount: number): gloas.BuilderPendingPayment {
  return {
    weight: 0,
    withdrawal: {feeRecipient: Buffer.alloc(20, 1), amount, builderIndex: 0},
    proposerIndex: proposer,
  };
}

/**
 * State in epoch 2 with payments of the slashed proposer in both halves of
 * builderPendingPayments and an unrelated proposer's payment next to them.
 */
function buildState(): CachedBeaconStateGloas {
  const config = getConfig(ForkName.gloas);
  const validators = generateValidators(16, {
    activation: 0,
    exit: FAR_FUTURE_EPOCH,
    withdrawableEpoch: FAR_FUTURE_EPOCH,
    balance: MAX_EFFECTIVE_BALANCE,
  });
  const state = generateState({slot: 2 * SLOTS_PER_EPOCH + 3, validators}, config) as BeaconStateGloas;
  state.builderPendingPayments.set(
    previousEpochPaymentIndex,
    ssz.gloas.BuilderPendingPayment.toViewDU(payment(proposerIndex, 7))
  );
  state.builderPendingPayments.set(
    currentEpochPaymentIndex,
    ssz.gloas.BuilderPendingPayment.toViewDU(payment(proposerIndex, 9))
  );
  state.builderPendingPayments.set(
    otherPaymentIndex,
    ssz.gloas.BuilderPendingPayment.toViewDU(payment(otherProposerIndex, 1))
  );
  state.commit();
  return createCachedBeaconState(state, {
    config: createBeaconConfig(config, state.genesisValidatorsRoot),
    pubkeyCache,
  }) as CachedBeaconStateGloas;
}

function paymentAmounts(state: CachedBeaconStateGloas): number[] {
  return [previousEpochPaymentIndex, currentEpochPaymentIndex, otherPaymentIndex].map(
    (i) => state.builderPendingPayments.getReadonly(i).withdrawal.amount
  );
}

describe("slashValidator builder pending payments", () => {
  it("clears every pending payment of the slashed proposer", () => {
    const state = buildState();
    expect(paymentAmounts(state)).toEqual([7, 9, 1]);

    slashValidator(ForkSeq.gloas, state, proposerIndex);

    expect(state.validators.getReadonly(proposerIndex).slashed).toBe(true);
    expect(paymentAmounts(state)).toEqual([0, 0, 1]);
  });

  it("clears pending payments when the proposer is slashed by an attester slashing", () => {
    const state = buildState();
    const attesterSlashing = ssz.electra.AttesterSlashing.defaultValue();
    attesterSlashing.attestation1.attestingIndices = [proposerIndex];
    attesterSlashing.attestation2.attestingIndices = [proposerIndex];
    attesterSlashing.attestation2.data.target.root = Buffer.alloc(32, 1);

    processAttesterSlashing(ForkSeq.gloas, state, attesterSlashing, false);

    expect(state.validators.getReadonly(proposerIndex).slashed).toBe(true);
    expect(paymentAmounts(state)).toEqual([0, 0, 1]);
  });

  it("clears pending payments in both epochs when the proposer is slashed by a proposer slashing", () => {
    const state = buildState();
    const proposerSlashing = ssz.phase0.ProposerSlashing.defaultValue();
    proposerSlashing.signedHeader1.message.slot = BigInt(state.slot - 1);
    proposerSlashing.signedHeader1.message.proposerIndex = proposerIndex;
    proposerSlashing.signedHeader2.message.slot = BigInt(state.slot - 1);
    proposerSlashing.signedHeader2.message.proposerIndex = proposerIndex;
    proposerSlashing.signedHeader2.message.parentRoot = Buffer.alloc(32, 1);

    processProposerSlashing(ForkSeq.gloas, state, proposerSlashing, false);

    expect(state.validators.getReadonly(proposerIndex).slashed).toBe(true);
    expect(paymentAmounts(state)).toEqual([0, 0, 1]);
  });
});
