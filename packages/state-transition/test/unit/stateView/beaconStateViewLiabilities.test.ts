import {describe, expect, it} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {pubkeyCache} from "@lodestar/native/pubkeys";
import {FAR_FUTURE_EPOCH, ForkName, MIN_DEPOSIT_AMOUNT, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {CachedBeaconStateGloas, createCachedBeaconState} from "../../../src/index.js";
import {BeaconStateView} from "../../../src/stateView/beaconStateView.js";
import {isStatePostGloas} from "../../../src/stateView/interface.js";
import {createBeaconStateView} from "../../../src/stateView/stateViewFactory.js";
import {generateState} from "../../utils/state.js";

describe("BeaconStateView prepared builder liabilities", () => {
  const config = createBeaconConfig(getConfig(ForkName.gloas), new Uint8Array(32));

  function fixture(): CachedBeaconStateGloas {
    const payments = ssz.gloas.BuilderPendingPayments.defaultValue();
    payments[SLOTS_PER_EPOCH + 4].withdrawal.amount = 700;
    const state = generateState(
      {
        slot: 5,
        latestBlockHeader: {...ssz.phase0.BeaconBlockHeader.defaultValue(), slot: 4},
        builders: [
          {
            ...ssz.gloas.Builder.defaultValue(),
            balance: MIN_DEPOSIT_AMOUNT + 1000,
            depositEpoch: 0,
            withdrawableEpoch: FAR_FUTURE_EPOCH,
          },
        ],
        builderPendingPayments: payments,
      },
      config
    );
    return createCachedBeaconState(state, {config, pubkeyCache}) as CachedBeaconStateGloas;
  }

  it("reads settled FULL-parent liabilities exactly without committing or mutating its parent", () => {
    const parent = new BeaconStateView(fixture());
    const applied = parent.withParentPayloadApplied(ssz.gloas.ExecutionRequests.defaultValue());
    expect(applied.builderPendingPayments[SLOTS_PER_EPOCH + 4].withdrawal.amount).toBe(0);
    expect(applied.builderPendingWithdrawals.map((withdrawal) => withdrawal.amount)).toEqual([700]);
    expect(applied.canBuilderCoverBid(0, 300)).toBe(true);
    expect(applied.canBuilderCoverBid(0, 301)).toBe(false);
    expect(parent.builderPendingPayments[SLOTS_PER_EPOCH + 4].withdrawal.amount).toBe(700);
    expect(parent.builderPendingWithdrawals).toEqual([]);
    expect(applied.builderPendingPayments).toBe(applied.builderPendingPayments);
    expect(applied.builderPendingWithdrawals).toBe(applied.builderPendingWithdrawals);
  });

  it("includes pending nested edits on both liability child views", () => {
    const state = fixture();
    const payment = state.builderPendingPayments.get(0);
    payment.weight = 3;
    payment.withdrawal.amount = 17;
    state.builderPendingWithdrawals.push(
      ssz.gloas.BuilderPendingWithdrawal.toViewDU({
        ...ssz.gloas.BuilderPendingWithdrawal.defaultValue(),
        amount: 19,
      })
    );
    const view = new BeaconStateView(state);
    expect(view.builderPendingPayments[0].weight).toBe(3);
    expect(view.builderPendingPayments[0].withdrawal.amount).toBe(17);
    expect(view.builderPendingWithdrawals[0].amount).toBe(19);
  });

  it("matches native FULL-parent liabilities and spendable balance", () => {
    const stateBytes = fixture().serialize();
    const parents = [false, true].map((nativeStateTransition) => {
      const state = createBeaconStateView({nativeStateTransition, config, stateBytes});
      if (!isStatePostGloas(state)) throw Error("Expected Gloas fixture");
      return state;
    });
    const applied = parents.map((parent) =>
      parent.withParentPayloadApplied(ssz.gloas.ExecutionRequests.defaultValue())
    );
    try {
      for (const view of applied) {
        expect(view.builderPendingPayments[SLOTS_PER_EPOCH + 4].withdrawal.amount).toBe(0);
        expect(view.builderPendingWithdrawals.map((withdrawal) => withdrawal.amount)).toEqual([700]);
        expect(view.canBuilderCoverBid(0, 300)).toBe(true);
        expect(view.canBuilderCoverBid(0, 301)).toBe(false);
      }
      expect(applied[1].hashTreeRoot()).toEqual(applied[0].hashTreeRoot());
      for (const parent of parents) {
        expect(parent.builderPendingPayments[SLOTS_PER_EPOCH + 4].withdrawal.amount).toBe(700);
        expect(parent.builderPendingWithdrawals).toEqual([]);
      }
    } finally {
      for (const view of [...applied, ...parents]) view.release();
    }
  });
});
