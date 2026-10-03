import {beforeEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {ApiError} from "@lodestar/api/server";
import {createBeaconConfig, createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {ProducedBlockSource, ssz} from "@lodestar/types";
import {ErrorAborted} from "@lodestar/utils";
import {NodeIsSyncing} from "../../../../src/api/impl/errors.js";
import {BeaconEngine} from "../../../../src/chain/beaconEngine/beaconEngine.js";
import {BeaconEngineErrorCode, ProduceBlockV4Request} from "../../../../src/chain/beaconEngine/interface.js";
import {BlockType, ProduceFullGloas} from "../../../../src/chain/produceBlock/index.js";
import {ApiTestModules, getApiTestModules} from "../../../utils/api.js";
import {generateProtoBlock} from "../../../utils/typeGenerator.js";

describe("BeaconEngine V4 production", () => {
  let modules: ApiTestModules;
  const config = createBeaconConfig(
    createChainForkConfig({
      ...defaultChainConfig,
      ALTAIR_FORK_EPOCH: 0,
      BELLATRIX_FORK_EPOCH: 0,
      CAPELLA_FORK_EPOCH: 0,
      DENEB_FORK_EPOCH: 0,
      ELECTRA_FORK_EPOCH: 0,
      FULU_FORK_EPOCH: 0,
      GLOAS_FORK_EPOCH: 0,
    }),
    Buffer.alloc(32)
  );
  const attrs: ProduceBlockV4Request = {
    slot: 1,
    randaoReveal: Buffer.alloc(96),
    graffiti: Buffer.alloc(32),
    includePayload: false,
    builderConfig: {minBid: 0n, builderBoostFactor: 100n, builders: []},
  };
  beforeEach(() => {
    modules = getApiTestModules({config});
    modules.chain.beaconEngine.produceBlockV4 = vi.fn(
      BeaconEngine.prototype.produceBlockV4.bind(modules.chain.beaconEngine)
    );
    modules.chain.getProposerHead.mockReturnValue(
      generateProtoBlock({slot: 0, executionPayloadBlockHash: "0x" + "00".repeat(32)})
    );
    vi.mocked(modules.chain.clock.msFromSlot).mockReturnValue(1000);
    modules.chain.forkChoice.shouldBuildOnFull = vi.fn().mockReturnValue(true);
    modules.chain.beaconEngine.produceCommonBlockBody = vi.fn().mockResolvedValue({});
  });

  for (const [hasBid, engineFails, bidFails, source] of [
    [false, false, false, ProducedBlockSource.engine],
    [true, false, false, ProducedBlockSource.builder],
    [true, false, true, ProducedBlockSource.engine],
    [true, true, false, ProducedBlockSource.builder],
  ] as const) {
    it(`selects ${source}: bid=${hasBid}, engineFails=${engineFails}, bidFails=${bidFails}`, async () => {
      const bid = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
      bid.message.value = 1;
      vi.spyOn(modules.chain.beaconEngine.executionPayloadBidPool, "getBestBid").mockReturnValue(
        hasBid ? {signedBid: bid, receivedMs: 0} : null
      );
      const engineBlock = ssz.gloas.BeaconBlock.defaultValue();
      const bidBlock = ssz.gloas.BeaconBlock.defaultValue();
      bidBlock.proposerIndex = 1;
      const artifacts: ProduceFullGloas = {
        type: BlockType.Full,
        fork: ForkName.gloas,
        executionPayload: ssz.gloas.ExecutionPayload.defaultValue(),
        executionRequests: ssz.gloas.ExecutionRequests.defaultValue(),
        blobsBundle: {blobs: [], commitments: [], proofs: []},
        cells: [],
        parentBlockRoot: Buffer.alloc(32),
      };
      modules.chain.produceBlockWrapper.mockImplementation(async (_type, request) => {
        if (request.builderBid ? bidFails : engineFails) throw Error("production failed");
        return {
          block: request.builderBid ? bidBlock : engineBlock,
          executionPayloadValue: 1n,
          consensusBlockValue: 2n,
          produceResult: artifacts,
        };
      });
      const result = await modules.chain.beaconEngine.produceBlockV4(attrs);
      expect(result.ok).toBe(true);
      if (!result.ok) throw Error(result.payload.message);
      expect(result.data.data).toBe(source === ProducedBlockSource.builder ? bidBlock : engineBlock);
      expect(result.data.executionPayloadSource).toBe(source);
      expect(result.data.produceResult).toBe(artifacts);
      expect(modules.chain.produceBlockWrapper).toHaveBeenCalledTimes(hasBid ? 2 : 1);
      if (hasBid) {
        const [engineCall, bidCall] = modules.chain.produceBlockWrapper.mock.calls;
        expect(engineCall[1].commonBlockBodyPromise).toBe(bidCall[1].commonBlockBodyPromise);
      }
    });
  }

  it("returns a plain syncing error for an unavailable parent", async () => {
    modules.chain.getProposerHead.mockReturnValue(
      generateProtoBlock({dataAvailabilityStatus: DataAvailabilityStatus.OutOfRange})
    );
    expect(await modules.chain.beaconEngine.produceBlockV4(attrs)).toEqual({
      ok: false,
      code: BeaconEngineErrorCode.NODE_SYNCING,
      payload: {message: "Block's data is out of range and not validated"},
    });
    expect(modules.chain.produceBlockWrapper).not.toHaveBeenCalled();
  });

  for (const [error, code, payload] of [
    [new ApiError(400, "invalid parent"), BeaconEngineErrorCode.API_ERROR, {status: 400, message: "invalid parent"}],
    [new NodeIsSyncing("waiting for parent"), BeaconEngineErrorCode.NODE_SYNCING, {message: "waiting for parent"}],
    [new ErrorAborted("closed"), BeaconEngineErrorCode.ABORTED, {message: "Aborted closed"}],
    [new Error("unexpected"), BeaconEngineErrorCode.INTERNAL, {message: "unexpected"}],
  ] as const) {
    it(`maps ${code} in both entries`, async () => {
      modules.chain.getProposerHead.mockImplementation(() => {
        throw error;
      });
      expect(await modules.chain.beaconEngine.produceBlockV4(attrs)).toEqual({ok: false, code, payload});
      expect(
        await BeaconEngine.prototype.produceBlock.call(modules.chain.beaconEngine, {
          ...attrs,
          builderSelection: routes.validator.BuilderSelection.ExecutionOnly,
          builderBoostFactor: 100n,
        })
      ).toEqual({ok: false, code, payload});
    });
  }

  it("returns INTERNAL when both production paths fail", async () => {
    vi.spyOn(modules.chain.beaconEngine.executionPayloadBidPool, "getBestBid").mockReturnValue({
      signedBid: ssz.gloas.SignedExecutionPayloadBid.defaultValue(),
      receivedMs: 0,
    });
    modules.chain.produceBlockWrapper.mockRejectedValue(Error("failed"));
    const result = await modules.chain.beaconEngine.produceBlockV4(attrs);
    expect(result.ok).toBe(false);
    if (result.ok) throw Error("expected failure");
    expect(result.code).toBe(BeaconEngineErrorCode.INTERNAL);
    expect(result.payload.message).toContain("Block production failed: engine=Error: failed builder=Error: failed");
  });
});
