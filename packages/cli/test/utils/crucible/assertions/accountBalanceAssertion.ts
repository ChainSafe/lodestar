import {EL_GENESIS_ACCOUNT} from "../constants.js";
import {Assertion, AssertionResult, Match, NodePair} from "../interfaces.js";

const transactionAmount = BigInt(2441406250);

export function createAccountBalanceAssertion({
  address,
  sendTransactionsAtSlot,
  validateTotalBalanceAt,
  targetNode,
}: {
  address: string;
  sendTransactionsAtSlot: number[];
  validateTotalBalanceAt: number[];
  targetNode: NodePair;
}): Assertion<`accountBalance_${typeof address}`, bigint> {
  return {
    id: `accountBalance_${address}`,
    match({slot, node}) {
      if (sendTransactionsAtSlot.includes(slot) && node.id === targetNode.id) return Match.Capture;
      if (validateTotalBalanceAt.includes(slot) && node.id === targetNode.id) return Match.Assert;
      return Match.None;
    },
    async capture({node}) {
      await node.execution.provider?.eth.sendTransaction({
        to: address,
        from: EL_GENESIS_ACCOUNT,
        gas: "0x76c0",
        gasPrice: "0x9184e72a000",
        value: transactionAmount,
      });

      // Capture the value transferred to account
      return transactionAmount;
    },
    async assert({node, store, slot}) {
      const errors: AssertionResult[] = [];

      const expectedCaptureSlots = sendTransactionsAtSlot.filter((s) => s <= slot);
      if (expectedCaptureSlots.length === 0) errors.push(`No transaction was sent to account ${address}`);

      let expectedBalanceAtCurrentSlot = BigInt(0);
      for (const captureSlot of expectedCaptureSlots) {
        expectedBalanceAtCurrentSlot += BigInt(store[captureSlot]);
      }

      const balance = await node.execution.provider?.eth.getBalance(address, "latest");

      if (balance !== expectedBalanceAtCurrentSlot) {
        errors.push(
          `Account balance for ${address} does not match. Expected: ${expectedBalanceAtCurrentSlot}, got: ${balance}`
        );
      }

      return errors;
    },
  };
}
