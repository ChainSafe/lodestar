import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {createBeaconConfig, createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {ProtoBlock} from "@lodestar/fork-choice";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ProducedBlockSource, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BeaconEngine} from "../../../../src/chain/beaconEngine/beaconEngine.js";
import {BeaconEngineErrorCode} from "../../../../src/chain/beaconEngine/interface.js";
import {BlockType} from "../../../../src/chain/produceBlock/index.js";
import {BuilderStatus} from "../../../../src/execution/builder/http.js";
import {SyncState} from "../../../../src/sync/interface.js";
import {toGraffitiBytes} from "../../../../src/util/graffiti.js";
import {ApiTestModules, getApiTestModules} from "../../../utils/api.js";
import {zeroProtoBlock} from "../../../utils/state.js";

describe("BeaconEngine V3 production race", () => {
  let modules: ApiTestModules;
  const config = createBeaconConfig(
    createChainForkConfig({...defaultChainConfig, ALTAIR_FORK_EPOCH: 0, BELLATRIX_FORK_EPOCH: 1}),
    Buffer.alloc(32, 0xaa)
  );
  beforeEach(() => {
    modules = getApiTestModules({config});
    vi.spyOn(modules.chain.clock, "msFromSlot").mockReturnValue(0);
    modules.chain.executionBuilder.status = BuilderStatus.enabled;
    modules.chain.beaconEngine.produceBlock = vi.fn(
      BeaconEngine.prototype.produceBlock.bind(modules.chain.beaconEngine)
    );
    modules.chain.beaconEngine.produceCommonBlockBody = vi.fn().mockResolvedValue({});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });
  const testCases: [routes.validator.BuilderSelection, number | null, number | null, number, boolean, string][] = [
    [routes.validator.BuilderSelection.MaxProfit, 1, 0, 0, false, "builder"],
    [routes.validator.BuilderSelection.MaxProfit, 1, 2, 1, false, "engine"],
    [routes.validator.BuilderSelection.MaxProfit, null, 0, 0, false, "engine"],
    [routes.validator.BuilderSelection.MaxProfit, 0, null, 1, false, "builder"],
    [routes.validator.BuilderSelection.MaxProfit, 0, null, 1, true, "builder"],
    [routes.validator.BuilderSelection.MaxProfit, 1, 1, 1, true, "engine"],
    [routes.validator.BuilderSelection.MaxProfit, 2, 1, 1, true, "engine"],

    [routes.validator.BuilderSelection.BuilderAlways, 1, 2, 0, false, "builder"],
    [routes.validator.BuilderSelection.BuilderAlways, 1, 0, 1, false, "builder"],
    [routes.validator.BuilderSelection.BuilderAlways, null, 0, 0, false, "engine"],
    [routes.validator.BuilderSelection.BuilderAlways, 0, null, 1, false, "builder"],
    [routes.validator.BuilderSelection.BuilderAlways, 0, 1, 1, true, "engine"],
    [routes.validator.BuilderSelection.BuilderAlways, 1, 1, 1, true, "engine"],
    [routes.validator.BuilderSelection.BuilderAlways, 1, null, 1, true, "builder"],

    [routes.validator.BuilderSelection.ExecutionAlways, 2, 1, 0, false, "engine"],
    [routes.validator.BuilderSelection.ExecutionAlways, 0, 1, 1, false, "engine"],
    [routes.validator.BuilderSelection.ExecutionAlways, 0, null, 0, false, "builder"],
    [routes.validator.BuilderSelection.ExecutionAlways, null, 0, 1, false, "engine"],
    [routes.validator.BuilderSelection.ExecutionAlways, 1, 1, 1, true, "engine"],

    [routes.validator.BuilderSelection.BuilderOnly, 0, 2, 0, false, "builder"],
    [routes.validator.BuilderSelection.ExecutionOnly, 2, 0, 1, false, "engine"],
    [routes.validator.BuilderSelection.BuilderOnly, 1, 1, 0, true, "builder"],
    [routes.validator.BuilderSelection.ExecutionOnly, 1, 1, 1, true, "engine"],
  ];

  for (const [
    builderSelection,
    builderPayloadValue,
    enginePayloadValue,
    consensusBlockValue,
    shouldOverrideBuilder,
    finalSelection,
  ] of testCases) {
    it(`produceBlockV3  - ${finalSelection} produces block`, async () => {
      const fullBlock = ssz.bellatrix.BeaconBlock.defaultValue();
      const blindedBlock = ssz.bellatrix.BlindedBeaconBlock.defaultValue();

      const slot = 1 * SLOTS_PER_EPOCH;
      fullBlock.slot = slot;
      blindedBlock.slot = slot;
      const randaoReveal = fullBlock.body.randaoReveal;
      const graffiti = "a".repeat(32);
      const feeRecipient = "0xccccccccccccccccccccccccccccccccccccccaa";
      const currentSlot = 1 * SLOTS_PER_EPOCH;

      vi.spyOn(modules.chain.clock, "currentSlot", "get").mockReturnValue(currentSlot);
      vi.spyOn(modules.sync, "state", "get").mockReturnValue(SyncState.Synced);
      modules.chain.recomputeForkChoiceHead.mockReturnValue({
        blockRoot: toRootHex(fullBlock.parentRoot),
      } as ProtoBlock);
      modules.chain.getProposerHead.mockReturnValue({blockRoot: toRootHex(fullBlock.parentRoot)} as ProtoBlock);
      modules.chain.forkChoice.getBlockDefaultStatus.mockReturnValue(zeroProtoBlock);

      modules.chain.produceBlockWrapper.mockImplementation(async (type) => {
        if (type === BlockType.Full) {
          if (enginePayloadValue === null) throw Error("not produced");
          return {
            block: fullBlock,
            executionPayloadValue: BigInt(enginePayloadValue),
            consensusBlockValue: BigInt(consensusBlockValue),
            shouldOverrideBuilder,
            produceResult: {
              type: BlockType.Full,
              fork: ForkName.bellatrix,
              executionPayload: fullBlock.body.executionPayload,
            },
          };
        }
        if (builderPayloadValue === null) throw Error("not produced");
        return {
          block: blindedBlock,
          executionPayloadValue: BigInt(builderPayloadValue),
          consensusBlockValue: BigInt(consensusBlockValue),
          produceResult: {type: BlockType.Blinded, fork: ForkName.bellatrix},
        };
      });
      const produceBlockOpts = {
        strictFeeRecipientCheck: false,
        builderSelection,
        feeRecipient,
      };

      const result = await modules.chain.beaconEngine.produceBlock({
        slot,
        randaoReveal,
        graffiti: toGraffitiBytes(graffiti),
        builderBoostFactor: 100n,
        ...produceBlockOpts,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw Error(result.payload.message);
      const {data: block, ...meta} = result.data;
      const expectedBlock = finalSelection === "builder" ? blindedBlock : {block: fullBlock};
      const expectedExecution = finalSelection === "builder";

      expect(block).toEqual(expectedBlock);
      expect(meta.executionPayloadBlinded).toEqual(expectedExecution);

      expect(modules.chain.beaconEngine.produceBlock).toHaveBeenCalledTimes(1);
      expect(modules.chain.produceBlockWrapper.mock.calls.filter(([type]) => type === BlockType.Blinded)).toHaveLength(
        builderSelection === routes.validator.BuilderSelection.ExecutionOnly ? 0 : 1
      );
      expect(modules.chain.produceBlockWrapper.mock.calls.filter(([type]) => type === BlockType.Full)).toHaveLength(
        builderSelection === routes.validator.BuilderSelection.BuilderOnly ? 0 : 1
      );
    });
  }
  for (const boost of [0n, 100n]) {
    it(`selects local block with builder pending: boost=${boost}`, async () => {
      vi.useFakeTimers();
      const slot = SLOTS_PER_EPOCH;
      const block = ssz.bellatrix.BeaconBlock.defaultValue();
      block.slot = slot;
      modules.chain.getProposerHead.mockReturnValue({...zeroProtoBlock, slot: slot - 1});
      modules.chain.produceBlockWrapper.mockImplementation(async (type, attrs) => {
        if (type === BlockType.Blinded) return new Promise(() => {});
        await attrs.commonBlockBodyPromise;
        return {
          block,
          executionPayloadValue: 1n,
          consensusBlockValue: 0n,
          produceResult: {
            type: BlockType.Full,
            fork: ForkName.bellatrix,
            executionPayload: block.body.executionPayload,
          },
        };
      });
      const production = modules.chain.beaconEngine.produceBlock({
        slot,
        randaoReveal: block.body.randaoReveal,
        graffiti: block.body.graffiti,
        builderSelection: routes.validator.BuilderSelection.MaxProfit,
        builderBoostFactor: boost,
      });
      let settled = false;
      void production.then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toBe(boost === 0n);
      await vi.advanceTimersByTimeAsync(2000);
      const result = await production;
      expect(result.ok).toBe(true);
      if (!result.ok) throw Error(result.payload.message);
      expect(result.data.executionPayloadSource).toBe(ProducedBlockSource.engine);
      expect(modules.chain.beaconEngine.produceCommonBlockBody).toHaveBeenCalledOnce();
    });
  }

  it("returns a plain error when both sources exceed the timeout", async () => {
    vi.useFakeTimers();
    modules.chain.getProposerHead.mockReturnValue(zeroProtoBlock);
    modules.chain.produceBlockWrapper.mockImplementation(() => new Promise(() => {}));
    const production = modules.chain.beaconEngine.produceBlock({
      slot: SLOTS_PER_EPOCH,
      randaoReveal: Buffer.alloc(96),
      graffiti: Buffer.alloc(32),
      builderSelection: routes.validator.BuilderSelection.MaxProfit,
      builderBoostFactor: 100n,
    });
    await vi.advanceTimersByTimeAsync(14000);
    expect(await production).toEqual({
      ok: false,
      code: BeaconEngineErrorCode.INTERNAL,
      payload: {message: "Builder and engine both failed to produce the block within timeout"},
    });
  });
});
