import {describe, expect, it, vi} from "vitest";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {reconstructExecutionPayloadEnvelopes} from "../../../../src/chain/blocks/reconstructExecutionPayloadEnvelopes.js";
import {PayloadReconstructionErrorCode} from "../../../../src/chain/errors/payloadReconstruction.js";
import {compactExecutionPayloadEnvelope} from "../../../../src/db/repositories/executionPayloadEnvelopeArchiveTypes.js";
import {IExecutionEngine} from "../../../../src/execution/engine/interface.js";
import {ExecutionPayloadBody} from "../../../../src/execution/engine/types.js";

function fixture(blockNumber = 100) {
  const full = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
  Object.assign(full.message.payload, {
    slotNumber: blockNumber * 2,
    blockNumber,
    transactions: [new Uint8Array([1, 2, 3])],
    withdrawals: [{...ssz.capella.Withdrawal.defaultValue(), amount: 100n}],
    blockAccessList: new Uint8Array([4, 5, 6]),
  });
  const body: ExecutionPayloadBody = {
    transactions: full.message.payload.transactions,
    withdrawals: full.message.payload.withdrawals,
    blockAccessList: full.message.payload.blockAccessList,
  };
  return {full, compact: compactExecutionPayloadEnvelope(full), body};
}

describe("reconstruct Gloas payload envelopes", () => {
  it("batches by execution block number despite skipped beacon slots", async () => {
    const fixtures = Array.from({length: 65}, (_, i) => fixture(i + 100));
    const engine = {
      getPayloadBodiesByRange: vi
        .fn<IExecutionEngine["getPayloadBodiesByRange"]>()
        .mockImplementation(async (_fork, start, count) =>
          fixtures.slice(start - 100, start - 100 + count).map(({body}) => body)
        ),
    };
    const result = await reconstructExecutionPayloadEnvelopes(
      engine,
      fixtures.map(({compact}) => compact)
    );
    expect(result).toEqual(fixtures.map(({full}) => full));
    expect(engine.getPayloadBodiesByRange.mock.calls).toEqual([
      [ForkName.gloas, 100, 32],
      [ForkName.gloas, 132, 32],
      [ForkName.gloas, 164, 1],
    ]);
  });

  it("respects gaps between execution blocks", async () => {
    const first = fixture(100);
    const last = fixture(103);
    const engine = {
      getPayloadBodiesByRange: vi
        .fn<IExecutionEngine["getPayloadBodiesByRange"]>()
        .mockResolvedValueOnce([first.body])
        .mockResolvedValueOnce([last.body]),
    };
    expect(await reconstructExecutionPayloadEnvelopes(engine, [first.compact, last.compact])).toEqual([
      first.full,
      last.full,
    ]);
    expect(engine.getPayloadBodiesByRange.mock.calls).toEqual([
      [ForkName.gloas, 100, 1],
      [ForkName.gloas, 103, 1],
    ]);
  });

  it.each(["transactions", "withdrawals", "blockAccessList"] as const)("rejects a mismatched %s", async (field) => {
    const {compact, body} = fixture();
    const corrupted = {...body};
    if (field === "transactions") corrupted.transactions = [];
    else if (field === "withdrawals") corrupted.withdrawals = [];
    else corrupted.blockAccessList = new Uint8Array();
    const engine = {
      getPayloadBodiesByRange: vi.fn<IExecutionEngine["getPayloadBodiesByRange"]>().mockResolvedValue([corrupted]),
    };
    await expect(reconstructExecutionPayloadEnvelopes(engine, [compact])).rejects.toMatchObject({
      type: {code: PayloadReconstructionErrorCode.PAYLOAD_ROOT_MISMATCH},
    });
  });

  it.each(["missing body", "short response", "pruned access list", "missing withdrawals"])(
    "reports unavailable execution data for %s",
    async (scenario) => {
      const {compact, body} = fixture();
      const response =
        scenario === "missing body"
          ? [null]
          : scenario === "short response"
            ? []
            : [{...body, ...(scenario === "pruned access list" ? {blockAccessList: null} : {withdrawals: null})}];
      const engine = {
        getPayloadBodiesByRange: vi.fn<IExecutionEngine["getPayloadBodiesByRange"]>().mockResolvedValue(response),
      };
      await expect(reconstructExecutionPayloadEnvelopes(engine, [compact])).rejects.toMatchObject({
        type: {code: PayloadReconstructionErrorCode.BODY_UNAVAILABLE},
      });
    }
  );

  it("rejects extra response bodies", async () => {
    const {compact, body} = fixture();
    const engine = {
      getPayloadBodiesByRange: vi.fn<IExecutionEngine["getPayloadBodiesByRange"]>().mockResolvedValue([body, body]),
    };
    await expect(reconstructExecutionPayloadEnvelopes(engine, [compact])).rejects.toMatchObject({
      type: {code: PayloadReconstructionErrorCode.INVALID_RESPONSE},
    });
  });
});
