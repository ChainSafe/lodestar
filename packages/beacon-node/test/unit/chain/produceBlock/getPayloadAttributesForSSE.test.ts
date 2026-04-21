import {describe, expect, it, vi} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
import {capella} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {getPayloadAttributesForSSE} from "../../../../src/chain/produceBlock/produceBlockBody.js";

const config = createChainForkConfig({
  ALTAIR_FORK_EPOCH: 0,
  BELLATRIX_FORK_EPOCH: 0,
  CAPELLA_FORK_EPOCH: 0,
  DENEB_FORK_EPOCH: 0,
  ELECTRA_FORK_EPOCH: 0,
  FULU_FORK_EPOCH: 0,
  GLOAS_FORK_EPOCH: 0,
});

describe("getPayloadAttributesForSSE", () => {
  it("uses fresh expected withdrawals when extending the parent payload, otherwise preserves stale payloadExpectedWithdrawals", () => {
    const freshWithdrawals: capella.Withdrawal[] = [
      {index: 1, validatorIndex: 2, address: new Uint8Array(20).fill(0x11), amount: 3n},
    ];
    const staleWithdrawals: capella.Withdrawal[] = [
      {index: 9, validatorIndex: 8, address: new Uint8Array(20).fill(0x22), amount: 7n},
    ];

    const parentBlockRoot = new Uint8Array(32).fill(0xcc);
    const extendingParentBlockHash = new Uint8Array(32).fill(0xaa);
    const nonExtendingParentBlockHash = new Uint8Array(32).fill(0xbb);

    const prepareState = {
      forkName: ForkName.gloas,
      genesisTime: 0,
      epoch: 0,
      latestExecutionPayloadBid: {
        blockHash: extendingParentBlockHash,
        parentBlockHash: nonExtendingParentBlockHash,
      },
      payloadExpectedWithdrawals: staleWithdrawals,
      getExpectedWithdrawals: vi.fn().mockReturnValue({expectedWithdrawals: freshWithdrawals}),
      getRandaoMix: vi.fn().mockReturnValue(new Uint8Array(32).fill(0xdd)),
      getBeaconProposer: vi.fn().mockReturnValue(123),
    };

    const getBlockHexAndBlockHash = vi.fn().mockReturnValue({
      executionPayloadBlockHash: toRootHex(extendingParentBlockHash),
      executionPayloadNumber: 99,
    });

    const chain = {
      config,
      forkChoice: {
        getBlockHexAndBlockHash,
      },
    };

    const extending = getPayloadAttributesForSSE(ForkName.gloas, chain as never, {
      prepareState: prepareState as never,
      prepareSlot: 1,
      parentBlockRoot,
      parentBlockHash: extendingParentBlockHash,
      feeRecipient: "0x" + "00".repeat(32),
    });

    const carryingStale = getPayloadAttributesForSSE(ForkName.gloas, chain as never, {
      prepareState: prepareState as never,
      prepareSlot: 1,
      parentBlockRoot,
      parentBlockHash: nonExtendingParentBlockHash,
      feeRecipient: "0x" + "00".repeat(32),
    });

    expect(extending.payloadAttributes.withdrawals).toEqual(freshWithdrawals);
    expect(carryingStale.payloadAttributes.withdrawals).toEqual(staleWithdrawals);
    expect(extending.parentBlockNumber).toBe(99);
    expect(carryingStale.parentBlockNumber).toBe(99);
    expect(prepareState.getExpectedWithdrawals).toHaveBeenCalledTimes(1);
    expect(getBlockHexAndBlockHash).toHaveBeenNthCalledWith(
      1,
      toRootHex(parentBlockRoot),
      toRootHex(extendingParentBlockHash)
    );
    expect(getBlockHexAndBlockHash).toHaveBeenNthCalledWith(
      2,
      toRootHex(parentBlockRoot),
      toRootHex(nonExtendingParentBlockHash)
    );
  });
});
