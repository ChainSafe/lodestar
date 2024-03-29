import {capella} from "@lodestar/types";
import {ApiError} from "@lodestar/api";
import {MAX_WITHDRAWALS_PER_PAYLOAD} from "@lodestar/params";
import {AssertionMatch, AssertionResult, SimulationAssertion} from "../interfaces.js";

type WithdrawalsData = {
  withdrawalCount: number;
  withdrawalAmount: bigint;
  validators: Record<number, {balanceInLastSlot: bigint; currentBalance: bigint; withdrawalAmount: bigint}>;
};

export function createWithdrawalAssertions<T extends string>(
  nodeId: T
): SimulationAssertion<`withdrawals_${T}`, WithdrawalsData> {
  return {
    id: `withdrawals_${nodeId}`,
    match({forkConfig, epoch, node}) {
      if (nodeId === node.id && epoch === forkConfig.CAPELLA_FORK_EPOCH)
        return AssertionMatch.Capture | AssertionMatch.Assert;

      return AssertionMatch.None;
    },
    async capture({block, node, slot}) {
      const withdrawals = (block as capella.SignedBeaconBlock).message.body.executionPayload.withdrawals;
      const withdrawalCount = withdrawals.length;
      let withdrawalAmount = BigInt(0);
      const validators: WithdrawalsData["validators"] = {};

      for (const withdrawal of withdrawals) {
        withdrawalAmount += withdrawal.amount;
        const validatorDataLastSlot = await node.beacon.api.beacon.getStateValidator(
          slot - 1,
          withdrawal.validatorIndex
        );
        const validatorDataCurrentSlot = await node.beacon.api.beacon.getStateValidator(
          slot,
          withdrawal.validatorIndex
        );
        ApiError.assert(validatorDataLastSlot);
        ApiError.assert(validatorDataCurrentSlot);

        validators[withdrawal.validatorIndex] = {
          withdrawalAmount: withdrawal.amount,
          balanceInLastSlot: BigInt(validatorDataLastSlot.response.data.balance),
          currentBalance: BigInt(validatorDataCurrentSlot.response.data.balance),
        };
      }

      return {
        withdrawalCount,
        withdrawalAmount,
        validators,
      };
    },
    async assert({store, slot}) {
      const errors: AssertionResult[] = [];

      if (store[slot].withdrawalCount < MAX_WITHDRAWALS_PER_PAYLOAD) {
        errors.push(
          `Not enough withdrawals found. Expected ${MAX_WITHDRAWALS_PER_PAYLOAD}, got ${store[slot].withdrawalCount}`
        );
      }

      for (const {currentBalance, withdrawalAmount, balanceInLastSlot} of Object.values(store[slot].validators)) {
        // A validator can get sync committee reward, so difference must be greater than zero
        if (currentBalance < balanceInLastSlot - withdrawalAmount) {
          errors.push(
            `Withdrawal amount ${withdrawalAmount} does not match the difference between balances. balanceInLastSlot=${balanceInLastSlot}, currentBalance=${currentBalance}`
          );
        }
      }
      return errors;
    },
    async dump({slot, nodes, store}) {
      /*
       * | Slot | Node 1             |                  |
       * |------|-------------------|------------------|-
       * |      | Withdrawal Amount | Withdrawal Count |
       * |------|-------------------|------------------|-
       * | 1    | 100000            | 2                |
       * | 2    | 150000            | 3                |
       */
      const result = [`Slot,${nodes.map((n) => n.beacon.id).join(", ,")}`];
      result.push(`,${nodes.map((_) => "Withdrawal Amount,Withdrawal Count").join(",")}`);
      for (let s = 1; s <= slot; s++) {
        let row = `${s}`;
        for (const node of nodes) {
          const {withdrawalAmount, withdrawalCount} = store[node.beacon.id][s] ?? {};
          row += `,${withdrawalAmount ?? "-"},${withdrawalCount ?? "-"}`;
        }
        result.push(row);
      }
      return {"withdrawals.csv": result.join("\n")};
    },
  };
}
