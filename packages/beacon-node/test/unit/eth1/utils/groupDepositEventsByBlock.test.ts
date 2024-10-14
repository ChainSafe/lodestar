import {describe, it, expect} from "vitest";
import {phase0} from "@lodestar/types";
import {groupDepositEventsByBlock} from "../../../../src/eth1/utils/groupDepositEventsByBlock.js";

describe("eth1 / util / groupDepositEventsByBlock", () => {
  it("should return deposit events by block sorted by index", () => {
    const depositData = {
      amount: 0,
      signature: Buffer.alloc(96),
      withdrawalCredentials: Buffer.alloc(32),
      pubkey: Buffer.alloc(48),
    };
    const depositEvents: phase0.DepositEvent[] = [
      {blockNumber: 1, index: 0, depositData},
      {blockNumber: 2, index: 2, depositData},
      {blockNumber: 2, index: 1, depositData},
      {blockNumber: 3, index: 4, depositData},
      {blockNumber: 3, index: 3, depositData},
    ];
    const blockEvents = groupDepositEventsByBlock(depositEvents);

    // Keep only the relevant info of the result
    const blockEventsIndexOnly = blockEvents.map((blockEvent) => ({
      blockNumber: blockEvent.blockNumber,
      deposits: blockEvent.depositEvents.map((deposit) => deposit.index),
    }));

    expect(blockEventsIndexOnly).toEqual([
      {blockNumber: 1, deposits: [0]},
      {blockNumber: 2, deposits: [1, 2]},
      {blockNumber: 3, deposits: [3, 4]},
    ]);
  });
});
