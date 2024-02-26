import {EL_GENESIS_ACCOUNT} from "../constants.js";
import {AssertionMatch, AssertionResult, NodePair, SimulationAssertion} from "../interfaces.js";

function hexToBigInt(num: string): bigint {
  return num.startsWith("0x") ? BigInt(num) : BigInt(`0x${num}`);
}

function bigIntToHex(num: bigint): string {
  return `0x${num.toString(16)}`;
}

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
}): SimulationAssertion<`accountBalance_${typeof address}`, bigint> {
  return {
    id: `accountBalance_${address}`,
    match({slot, node}) {
      if (sendTransactionsAtSlot.includes(slot) && node.id === targetNode.id) return AssertionMatch.Capture;
      if (validateTotalBalanceAt.includes(slot) && node.id === targetNode.id) return AssertionMatch.Assert;
      return AssertionMatch.None;
    },
    async capture({node}) {
      await node.execution.provider?.getRpc().fetch({
        method: "eth_sendTransaction",
        params: [
          {
            to: address,
            from: EL_GENESIS_ACCOUNT,
            gas: "0x76c0",
            gasPrice: "0x9184e72a000",
            value: bigIntToHex(transactionAmount),
          },
        ],
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

      const balance = hexToBigInt(
        (await node.execution.provider?.getRpc().fetch({method: "eth_getBalance", params: [address, "latest"]})) ??
          "0x0"
      );

      if (balance !== expectedBalanceAtCurrentSlot) {
        errors.push(
          `Account balance for ${address} does not match. Expected: ${expectedBalanceAtCurrentSlot}, got: ${balance}`
        );
      }

      return errors;
    },
  };
}
