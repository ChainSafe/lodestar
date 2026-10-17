import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName} from "@lodestar/params";
import {gloas, ssz} from "@lodestar/types";
import {defer, fromHex, toRootHex} from "@lodestar/utils";
import {BeaconEngineCore} from "../../../../src/chain/beaconEngine/beaconEngineCore.js";
import {SeenEnginePayloadEnvelopeInput} from "../../../../src/chain/beaconEngine/seenEnginePayloadEnvelopeInput.js";
import {BlockInputNoData, BlockInputSource} from "../../../../src/chain/blocks/blockInput/index.js";
import {PayloadEnvelopeInputSource} from "../../../../src/chain/blocks/payloadEnvelopeInput/types.js";
import {BlockErrorCode, BlockGossipError, GossipAction} from "../../../../src/chain/errors/index.js";
import {defaultChainOptions} from "../../../../src/chain/options.js";
import * as blockValidation from "../../../../src/chain/validation/block.js";
import {ExecutionEngineDisabled} from "../../../../src/execution/engine/disabled.js";
import {getApiTestModules} from "../../../utils/api.js";
import {zeroProtoBlock} from "../../../utils/state.js";

describe("payload input creation when a block first enters BeaconEngineCore", () => {
  const config = createBeaconConfig(getConfig(ForkName.gloas), Buffer.alloc(32));
  let engine: BeaconEngineCore;
  let block: gloas.SignedBeaconBlock;
  let root: string;

  beforeEach(() => {
    const modules = getApiTestModules({config});
    engine = new BeaconEngineCore({
      config,
      opts: {...defaultChainOptions},
      logger: modules.logger,
      metrics: null,
      clock: modules.chain.clock,
      db: modules.db,
      dbName: "test",
      dataColumnDir: "test",
      pubkeyCache: modules.chain.pubkeyCache,
      cpStateDatastore: {write: vi.fn(), remove: vi.fn(), read: vi.fn(), readLatestSafe: vi.fn(), readKeys: vi.fn()},
      signal: new AbortController().signal,
      validatorMonitorOpts: null,
      isAnchorStateFinalized: true,
      executionEngine: new ExecutionEngineDisabled(),
    });
    engine.forkChoice = modules.chain.forkChoice;
    modules.chain.forkChoice.getBlockHexDefaultStatus.mockReturnValue(zeroProtoBlock);
    engine.regen = modules.chain.regen;
    vi.spyOn(blockValidation, "verifyBlockProposerSignature").mockResolvedValue(undefined);
    engine.seenPayloadEnvelopeInputCache = new SeenEnginePayloadEnvelopeInput({
      config,
      forkChoice: engine.forkChoice,
      db: modules.db,
    });
    vi.spyOn(engine, "publishChainView").mockImplementation(() => {});
    block = ssz.gloas.SignedBeaconBlock.defaultValue();
    block.message.slot = 1;
    block.message.proposerIndex = 7;
    root = toRootHex(ssz.gloas.BeaconBlock.hashTreeRoot(block.message));
  });

  afterEach(() => vi.restoreAllMocks());

  it.each(["accept", "unknown_parent", "observed_sibling", "unobserved_sibling", "reject", "unexpected"])(
    "retains only signature-verified gossip blocks for %s",
    async (scenario) => {
      vi.spyOn(engine, "hasObservedBlockRoot").mockReturnValue(scenario === "observed_sibling");
      vi.spyOn(blockValidation, "validateGossipBlock").mockImplementation(async () => {
        expect(engine.seenPayloadEnvelopeInputCache.get(root)).toBeUndefined();
        switch (scenario) {
          case "accept":
            return {skippedSlots: 0};
          case "unknown_parent":
            throw new BlockGossipError(GossipAction.IGNORE, {
              code: BlockErrorCode.PARENT_BLOCK_UNKNOWN,
              parentRoot: toRootHex(block.message.parentRoot),
            });
          case "observed_sibling":
          case "unobserved_sibling":
            throw new BlockGossipError(GossipAction.IGNORE, {
              code: BlockErrorCode.REPEAT_PROPOSAL,
              proposerIndex: 7,
              root,
            });
          case "reject":
            throw new BlockGossipError(GossipAction.REJECT, {
              code: BlockErrorCode.PROPOSAL_SIGNATURE_INVALID,
              slot: 1,
              root,
            });
          default:
            throw new Error("unexpected validation failure");
        }
      });
      const pending = engine.validateGossipBlock(
        fromHex(root),
        ssz.gloas.SignedBeaconBlock.serialize(block),
        ForkName.gloas,
        0
      );
      if (scenario === "unexpected")
        await expect(pending).resolves.toMatchObject({err: {status: "ignore", code: "UNEXPECTED_ERROR"}});
      else
        await expect(pending).resolves.toMatchObject({
          err: scenario === "accept" ? null : {status: scenario === "reject" ? "reject" : "ignore"},
        });
      expect(engine.blockSerializedCache.get(root) !== undefined).toBe(
        ["accept", "unknown_parent", "observed_sibling"].includes(scenario)
      );
      expect(engine.seenPayloadEnvelopeInputCache.get(root) !== undefined).toBe(
        ["accept", "unknown_parent", "observed_sibling"].includes(scenario)
      );
    }
  );

  it.each([true, false])("authenticates unknown-parent blocks before caching them (valid=%s)", async (valid) => {
    const verified = defer<void>();
    vi.spyOn(blockValidation, "validateGossipBlock").mockRejectedValue(
      new BlockGossipError(GossipAction.IGNORE, {
        code: BlockErrorCode.PARENT_BLOCK_UNKNOWN,
        parentRoot: toRootHex(block.message.parentRoot),
      })
    );
    vi.mocked(blockValidation.verifyBlockProposerSignature).mockReturnValue(verified.promise);
    const pending = engine.validateGossipBlock(
      fromHex(root),
      ssz.gloas.SignedBeaconBlock.serialize(block),
      ForkName.gloas,
      0
    );
    await vi.waitFor(() => expect(blockValidation.verifyBlockProposerSignature).toHaveBeenCalledOnce());
    expect(engine.seenPayloadEnvelopeInputCache.get(root)).toBeUndefined();
    expect(engine.hasObservedBlockRoot(1, 7, root)).toBe(false);
    if (valid) verified.resolve();
    else
      verified.reject(
        new BlockGossipError(GossipAction.REJECT, {code: BlockErrorCode.PROPOSAL_SIGNATURE_INVALID, slot: 1, root})
      );
    expect(await pending).toMatchObject({
      err: {
        status: valid ? "ignore" : "reject",
        code: valid ? BlockErrorCode.PARENT_BLOCK_UNKNOWN : BlockErrorCode.PROPOSAL_SIGNATURE_INVALID,
      },
    });
    expect(engine.seenPayloadEnvelopeInputCache.get(root) !== undefined).toBe(valid);
    expect(engine.hasObservedBlockRoot(1, 7, root)).toBe(valid);
    expect(engine.blockSerializedCache.get(root) !== undefined).toBe(valid);
  });

  it.each(["truncated", "invalid_offset", "root_mismatch"])(
    "returns a plain rejection for %s without replacing existing cache entries",
    async (scenario) => {
      const validBytes = ssz.gloas.SignedBeaconBlock.serialize(block);
      const entry = engine.blockSerializedCache.set(root, block, validBytes);
      let bytes: Uint8Array;
      if (scenario === "truncated") {
        bytes = new Uint8Array();
      } else if (scenario === "invalid_offset") {
        bytes = validBytes.slice();
        new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(0, 0, true);
      } else {
        const otherBlock = ssz.gloas.SignedBeaconBlock.clone(block);
        otherBlock.message.slot++;
        bytes = ssz.gloas.SignedBeaconBlock.serialize(otherBlock);
      }
      const validate = vi.spyOn(blockValidation, "validateGossipBlock");

      const result = await engine.validateGossipBlock(fromHex(root), bytes, ForkName.gloas, 0);

      expect(result).toMatchObject({
        err: {
          status: "reject",
          code: scenario === "root_mismatch" ? "BLOCK_ROOT_MISMATCH" : "INVALID_BLOCK_SSZ",
        },
      });
      expect(result).toHaveProperty("err.error", undefined);
      expect(structuredClone(result)).toEqual(result);
      expect(validate).not.toHaveBeenCalled();
      expect(engine.blockSerializedCache.get(root)).toBe(entry);
      expect(engine.seenPayloadEnvelopeInputCache.get(root)).toBeUndefined();
    }
  );

  it("returns ignore and clears the decoded block if payload cache initialization fails", async () => {
    vi.spyOn(blockValidation, "validateGossipBlock").mockResolvedValue({skippedSlots: 0});
    const error = new Error("payload cache initialization failed");
    vi.spyOn(engine.seenPayloadEnvelopeInputCache, "add").mockImplementation(() => {
      throw error;
    });

    await expect(
      engine.validateGossipBlock(fromHex(root), ssz.gloas.SignedBeaconBlock.serialize(block), ForkName.gloas, 0)
    ).resolves.toMatchObject({err: {status: "ignore", code: "UNEXPECTED_ERROR"}});
    expect(engine.blockSerializedCache.get(root)).toBeUndefined();
    expect(engine.logger.error).toHaveBeenCalledWith(
      "Error validating gossip block",
      {root, code: "UNEXPECTED_ERROR"},
      error
    );
  });

  it("retains API observations on validation failure and preserves an existing envelope candidate", async () => {
    vi.spyOn(blockValidation, "validateGossipBlock").mockResolvedValue({skippedSlots: 0});
    await engine.validateGossipBlock(fromHex(root), ssz.gloas.SignedBeaconBlock.serialize(block), ForkName.gloas);
    const input = engine.seenPayloadEnvelopeInputCache.get(root);
    expect(input).toBeDefined();
    const envelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
    envelope.message.beaconBlockRoot = ssz.gloas.BeaconBlock.hashTreeRoot(block.message);
    input?.addPayloadEnvelope({envelope, source: PayloadEnvelopeInputSource.api, seenTimestampSec: 1});
    vi.mocked(blockValidation.validateGossipBlock).mockRejectedValue(
      new BlockGossipError(GossipAction.REJECT, {code: BlockErrorCode.PROPOSAL_SIGNATURE_INVALID, slot: 1, root})
    );
    expect(
      (await engine.validateGossipBlock(fromHex(root), ssz.gloas.SignedBeaconBlock.serialize(block), ForkName.gloas))
        .err?.status
    ).toBe("reject");
    expect(engine.seenPayloadEnvelopeInputCache.get(root)).toBe(input);
    expect(input?.getPayloadEnvelope()).toBe(envelope);
  });

  it("seeds every block in a verification batch before pre-state regeneration", async () => {
    const blocks = [block, ssz.gloas.SignedBeaconBlock.clone(block)];
    blocks[1].message.slot = 2;
    const inputs = blocks.map((block) =>
      BlockInputNoData.createFromBlock({
        block,
        blockRootHex: toRootHex(ssz.gloas.BeaconBlock.hashTreeRoot(block.message)),
        forkName: ForkName.gloas,
        daOutOfRange: false,
        source: BlockInputSource.byRange,
        seenTimestampSec: 0,
      })
    );
    vi.spyOn(engine.regen, "getPreState").mockImplementation(async () => {
      for (const input of inputs) {
        expect(engine.seenPayloadEnvelopeInputCache.get(input.blockRootHex)?.proposerIndex, `slot ${input.slot}`).toBe(
          7
        );
      }
      throw new Error("pre-state unavailable");
    });
    await expect(
      engine.verifyBlocks(
        blocks.map((block) => ({
          blockRoot: ssz.gloas.BeaconBlock.hashTreeRoot(block.message),
          blockBytes: ssz.gloas.SignedBeaconBlock.serialize(block),
        })),
        {}
      )
    ).resolves.toMatchObject({
      err: {type: {code: BlockErrorCode.PRESTATE_MISSING}},
    });
    expect(engine.seenPayloadEnvelopeInputCache.size()).toBe(2);
  });

  it("seeds a locally produced block before proposer signature verification", async () => {
    vi.spyOn(blockValidation, "verifyBlockProposerSignature").mockImplementation(async () => {
      expect(engine.seenPayloadEnvelopeInputCache.get(root)?.getBid()).toEqual(
        block.message.body.signedExecutionPayloadBid.message
      );
      throw new Error("invalid proposer signature");
    });
    await expect(engine.verifyAndObserveBlockProposer(new Uint8Array(), block, root)).rejects.toThrow(
      "invalid proposer signature"
    );
    expect(engine.seenPayloadEnvelopeInputCache.get(root)?.proposerIndex).toBe(7);
  });

  it("does not create payload inputs for pre-Gloas blocks", async () => {
    vi.spyOn(blockValidation, "validateGossipBlock").mockResolvedValue({skippedSlots: 0});
    const block = ssz.phase0.SignedBeaconBlock.defaultValue();
    await engine.validateGossipBlock(
      ssz.phase0.BeaconBlock.hashTreeRoot(block.message),
      ssz.phase0.SignedBeaconBlock.serialize(block),
      ForkName.phase0
    );
    expect(engine.seenPayloadEnvelopeInputCache.size()).toBe(0);
  });
});
