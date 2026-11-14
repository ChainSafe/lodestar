import {afterEach, describe, expect, it, vi} from "vitest";
import {ExecutionStatus, LVHInvalidJudged} from "@lodestar/fork-choice";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {toRootHex} from "@lodestar/utils";
import {PayloadErrorCode, importExecutionPayload} from "../../../../src/chain/blocks/importExecutionPayload.js";
import type {BeaconChain} from "../../../../src/chain/chain.js";
import {ExecutionInvalidSource} from "../../../../src/chain/forkChoice/index.js";
import {PayloadEnvelopeInput} from "../../../../src/chain/seenCache/seenPayloadEnvelopeInput.js";
import {ExecutionPayloadStatus} from "../../../../src/execution/index.js";

vi.mock("../../../../src/chain/blocks/verifyExecutionPayloadEnvelope.js", () => ({
  verifyExecutionPayloadEnvelope: vi.fn(),
  verifyExecutionPayloadEnvelopeSignature: vi.fn().mockResolvedValue(true),
}));
vi.mock("@lodestar/state-transition", async (importActual) => ({
  ...(await importActual<typeof import("@lodestar/state-transition")>()),
  isStatePostGloas: () => true,
  isStatePostHeze: () => false,
}));

describe("chain / blocks / importExecutionPayload INVALID verdict", () => {
  const slot = 10;
  const blockRootHex = "0x0b";
  const blockHashHex = "0xb1";
  const parentRoot = "0x0a";
  const parentHash = new Uint8Array(32).fill(0xa1);
  const parentHashHex = toRootHex(parentHash);
  const ancestorHashHex = toRootHex(new Uint8Array(32).fill(0x91));

  function setup(latestValidHash: string | null) {
    const invalidateExecutionPayloads = vi.fn();
    const chain = {
      config: {getForkName: () => "gloas"},
      clock: {currentSlot: slot + 1000},
      logger: {debug: vi.fn()},
      metrics: null,
      forkChoice: {
        getBlockHexDefaultStatus: () => ({
          slot,
          blockRoot: blockRootHex,
          parentRoot,
          executionStatus: ExecutionStatus.Syncing,
        }),
      },
      regen: {getBlockSlotState: vi.fn().mockResolvedValue({})},
      executionEngine: {
        notifyNewPayload: vi.fn().mockResolvedValue({
          status: ExecutionPayloadStatus.INVALID,
          latestValidHash,
          validationError: "bad payload",
        }),
        invalidateExecutionPayloads,
      },
    } as unknown as BeaconChain;
    const payloadInput = {
      blockRootHex,
      getBlockHashHex: () => blockHashHex,
      getVersionedHashes: () => [],
      getPayloadEnvelope: () => ({message: {payload: {slotNumber: slot, parentHash}}}),
    } as unknown as PayloadEnvelopeInput;
    const run = importExecutionPayload.call(chain, payloadInput, DataAvailabilityStatus.Available, {
      validSignature: true,
    });
    return {run, invalidateExecutionPayloads};
  }

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("invalidates the parent payload chain when the latest valid hash is above the parent", async () => {
    const {run, invalidateExecutionPayloads} = setup(ancestorHashHex);

    await expect(run).rejects.toMatchObject({type: {code: PayloadErrorCode.EXECUTION_ENGINE_INVALID}});
    expect(invalidateExecutionPayloads).toHaveBeenCalledExactlyOnceWith(
      {
        executionStatus: ExecutionStatus.Invalid,
        latestValidExecHash: ancestorHashHex,
        invalidateFromBlockRoot: parentRoot,
        invalidateFromBlockHash: parentHashHex,
        judged: LVHInvalidJudged.ChildPayload,
      },
      ExecutionInvalidSource.newPayload,
      {slot, root: blockRootHex, payloadBlockHash: blockHashHex}
    );
  });

  for (const [name, latestValidHash] of [
    ["equals the parent hash", parentHashHex],
    ["is null", null],
  ] as const) {
    it(`leaves fork choice alone when the latest valid hash ${name}`, async () => {
      const {run, invalidateExecutionPayloads} = setup(latestValidHash);

      await expect(run).rejects.toMatchObject({type: {code: PayloadErrorCode.EXECUTION_ENGINE_INVALID}});
      expect(invalidateExecutionPayloads).not.toHaveBeenCalled();
    });
  }
});
