import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName} from "@lodestar/params";
import {signedBlockToSignedHeader} from "@lodestar/state-transition";
import {gloas, ssz} from "@lodestar/types";
import {defer, toRootHex} from "@lodestar/utils";
import {BeaconEngineCore} from "../../../../src/chain/beaconEngine/beaconEngineCore.js";
import {SeenEnginePayloadEnvelopeInput} from "../../../../src/chain/beaconEngine/seenEnginePayloadEnvelopeInput.js";
import {BlockInputNoData, BlockInputSource} from "../../../../src/chain/blocks/blockInput/index.js";
import {PayloadEnvelopeInputSource} from "../../../../src/chain/blocks/payloadEnvelopeInput/types.js";
import {
  SignedBlockRootHex,
  computeSignedBlockRoot,
  toSignedBlockRootHex,
} from "../../../../src/chain/blocks/signedBlockRoot.js";
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
  let signedRoot: SignedBlockRootHex;

  beforeEach(async () => {
    const modules = getApiTestModules({config});
    engine = new BeaconEngineCore({
      config,
      opts: {...defaultChainOptions},
      logging: {type: "injected", logger: modules.logger},
      metricsEnabled: false,
      genesisTime: modules.chain.clock.genesisTime,
      clock: modules.chain.clock,
      db: modules.db,
      dbName: "test",
      dataDir: "test",
      dataColumnDir: "test",
      cpStateDatastore: {write: vi.fn(), remove: vi.fn(), read: vi.fn(), readLatestSafe: vi.fn(), readKeys: vi.fn()},
      validatorMonitorOpts: null,
      isAnchorStateFinalized: true,
      executionEngine: new ExecutionEngineDisabled(),
    });
    await engine.init();
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
    signedRoot = toSignedBlockRootHex(computeSignedBlockRoot(ForkName.gloas, block));
  });

  afterEach(() => vi.restoreAllMocks());

  it.each(["accept", "reject", "unexpected"])(
    "keeps the processing cache unchanged during API gossip validation: %s",
    async (scenario) => {
      const candidate = ssz.gloas.SignedBeaconBlock.clone(block);
      candidate.signature = Uint8Array.from(candidate.signature);
      candidate.signature[0] = 1;
      const candidateRoot = toSignedBlockRootHex(computeSignedBlockRoot(ForkName.gloas, candidate));
      const entry = engine.blockSerializedCache.set(
        candidateRoot,
        candidate,
        ssz.gloas.SignedBeaconBlock.serialize(candidate)
      );
      const getOrDeserialize = vi.spyOn(engine.blockSerializedCache, "getOrDeserialize");
      const set = vi.spyOn(engine.blockSerializedCache, "set");
      const remove = vi.spyOn(engine.blockSerializedCache, "delete");
      vi.spyOn(blockValidation, "validateGossipBlock").mockImplementation(async () => {
        if (scenario === "reject") {
          throw new BlockGossipError(GossipAction.REJECT, {
            code: BlockErrorCode.PROPOSAL_SIGNATURE_INVALID,
            slot: 1,
            root,
          });
        }
        if (scenario === "unexpected") throw new Error("API validation failed");
        return {skippedSlots: 0};
      });

      const result = await engine.validateGossipBlockBytes(
        computeSignedBlockRoot(ForkName.gloas, block),
        ssz.gloas.SignedBeaconBlock.serialize(block),
        ForkName.gloas
      );

      expect(result.err === null).toBe(scenario === "accept");
      expect(engine.blockSerializedCache.get(candidateRoot)).toBe(entry);
      expect(engine.blockSerializedCache.get(signedRoot)).toBeUndefined();
      expect(getOrDeserialize).not.toHaveBeenCalled();
      expect(set).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
    }
  );

  it.each(["reject", "unexpected"])(
    "preserves another signature when gossip validation fails: %s",
    async (scenario) => {
      const candidate = ssz.gloas.SignedBeaconBlock.clone(block);
      candidate.signature = Uint8Array.from(candidate.signature);
      candidate.signature[0] = 1;
      const candidateRoot = toSignedBlockRootHex(computeSignedBlockRoot(ForkName.gloas, candidate));
      const entry = engine.blockSerializedCache.set(
        candidateRoot,
        candidate,
        ssz.gloas.SignedBeaconBlock.serialize(candidate)
      );
      vi.spyOn(blockValidation, "validateGossipBlock").mockImplementation(async () => {
        if (scenario === "unexpected") throw new Error("gossip validation failed");
        throw new BlockGossipError(GossipAction.REJECT, {
          code: BlockErrorCode.PROPOSAL_SIGNATURE_INVALID,
          slot: 1,
          root,
        });
      });

      const result = await engine.validateGossipBlockBytes(
        computeSignedBlockRoot(ForkName.gloas, block),
        ssz.gloas.SignedBeaconBlock.serialize(block),
        ForkName.gloas,
        0
      );

      expect(result.err?.status).toBe(scenario === "reject" ? "reject" : "ignore");
      expect(engine.blockSerializedCache.get(signedRoot)).toBeUndefined();
      expect(engine.blockSerializedCache.get(candidateRoot)).toBe(entry);
    }
  );

  it.each([
    "accept",
    "unknown_parent",
    "observed_sibling",
    "unobserved_sibling",
    "sibling_unknown_parent",
    "reject",
    "unexpected",
  ])("retains only signature-verified gossip blocks for %s", async (scenario) => {
    if (scenario === "observed_sibling" || scenario === "sibling_unknown_parent") {
      engine.seenBlockProposers.observeBlockRoot(1, 7, root, signedBlockToSignedHeader(config, block));
    }
    if (scenario === "sibling_unknown_parent") {
      vi.spyOn(engine.forkChoice, "getBlockHexDefaultStatus").mockReturnValue(null);
    }
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
        case "sibling_unknown_parent":
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
    const pending = engine.validateGossipBlockBytes(
      computeSignedBlockRoot(ForkName.gloas, block),
      ssz.gloas.SignedBeaconBlock.serialize(block),
      ForkName.gloas,
      0
    );
    await expect(pending).resolves.toHaveProperty("shouldProcessRepeatProposalBlock", scenario === "observed_sibling");
    if (scenario === "unexpected")
      await expect(pending).resolves.toMatchObject({err: {status: "ignore", code: "UNEXPECTED_ERROR"}});
    else
      await expect(pending).resolves.toMatchObject({
        err: scenario === "accept" ? null : {status: scenario === "reject" ? "reject" : "ignore"},
      });
    const result = await pending;
    if (result.err?.error instanceof BlockGossipError) {
      expect(structuredClone(result).blockErrorType).toEqual(result.err.error.type);
    } else {
      expect(result.blockErrorType).toBeUndefined();
    }
    expect(engine.blockSerializedCache.get(signedRoot) !== undefined).toBe(
      ["accept", "unknown_parent", "observed_sibling"].includes(scenario)
    );
    expect(engine.seenPayloadEnvelopeInputCache.get(root) !== undefined).toBe(
      ["accept", "unknown_parent", "observed_sibling"].includes(scenario)
    );
  });

  it.each([true, false])("authenticates unknown-parent blocks before caching them (valid=%s)", async (valid) => {
    const verified = defer<void>();
    vi.spyOn(blockValidation, "validateGossipBlock").mockRejectedValue(
      new BlockGossipError(GossipAction.IGNORE, {
        code: BlockErrorCode.PARENT_BLOCK_UNKNOWN,
        parentRoot: toRootHex(block.message.parentRoot),
      })
    );
    vi.mocked(blockValidation.verifyBlockProposerSignature).mockReturnValue(verified.promise);
    const pending = engine.validateGossipBlockBytes(
      computeSignedBlockRoot(ForkName.gloas, block),
      ssz.gloas.SignedBeaconBlock.serialize(block),
      ForkName.gloas,
      0
    );
    await vi.waitFor(() => expect(blockValidation.verifyBlockProposerSignature).toHaveBeenCalledOnce());
    expect(engine.seenPayloadEnvelopeInputCache.get(root)).toBeUndefined();
    expect(engine.seenBlockProposers.hasBlockRoot(1, 7, root)).toBe(false);
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
    expect(engine.seenBlockProposers.hasBlockRoot(1, 7, root)).toBe(valid);
    expect(engine.blockSerializedCache.get(signedRoot) !== undefined).toBe(valid);
  });

  it.each(["accept", "repeat", "reject", "unexpected", "invalid_signature"])(
    "processes gossip equivocation evidence on completion for %s, without applying gossip side effects to API calls",
    async (scenario) => {
      const process = vi.spyOn(engine, "processProposerEquivocation").mockImplementation(() => {});
      vi.spyOn(blockValidation, "validateGossipBlock").mockImplementation(async () => {
        if (scenario !== "invalid_signature") {
          engine.seenBlockProposers.observeBlockRoot(1, 7, root, signedBlockToSignedHeader(config, block));
        }
        switch (scenario) {
          case "accept":
            return {skippedSlots: 0};
          case "repeat":
            throw new BlockGossipError(GossipAction.IGNORE, {
              code: BlockErrorCode.REPEAT_PROPOSAL,
              proposerIndex: 7,
              root,
            });
          case "unexpected":
            throw new Error("unexpected validation failure");
          default:
            throw new BlockGossipError(GossipAction.REJECT, {
              code:
                scenario === "reject" ? BlockErrorCode.INCORRECT_PROPOSER : BlockErrorCode.PROPOSAL_SIGNATURE_INVALID,
              slot: 1,
              proposerIndex: 7,
              root,
            });
        }
      });
      const sibling = ssz.gloas.SignedBeaconBlock.clone(block);
      sibling.message.stateRoot = Buffer.alloc(32, 1);
      const siblingRoot = toRootHex(ssz.gloas.BeaconBlock.hashTreeRoot(sibling.message));
      engine.seenBlockProposers.observeBlockRoot(1, 7, siblingRoot, signedBlockToSignedHeader(config, sibling));
      const bytes = ssz.gloas.SignedBeaconBlock.serialize(block);

      await engine.validateGossipBlockBytes(computeSignedBlockRoot(ForkName.gloas, block), bytes, ForkName.gloas, 0);

      if (scenario === "invalid_signature") expect(process).not.toHaveBeenCalled();
      else expect(process).toHaveBeenCalledExactlyOnceWith(1, 7);

      process.mockClear();
      await engine.validateGossipBlockBytes(computeSignedBlockRoot(ForkName.gloas, block), bytes, ForkName.gloas);
      expect(process).not.toHaveBeenCalled();
    }
  );

  it.each(["truncated", "invalid_offset", "root_mismatch"])(
    "returns a plain rejection for %s without replacing existing cache entries",
    async (scenario) => {
      const validBytes = ssz.gloas.SignedBeaconBlock.serialize(block);
      const entry = engine.blockSerializedCache.set(signedRoot, block, validBytes);
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

      const result = await engine.validateGossipBlockBytes(
        computeSignedBlockRoot(ForkName.gloas, block),
        bytes,
        ForkName.gloas,
        0
      );

      expect(result).toMatchObject({
        err: {
          status: "reject",
          code: scenario === "root_mismatch" ? "SIGNED_BLOCK_ROOT_MISMATCH" : "INVALID_BLOCK_SSZ",
        },
      });
      expect(result).toHaveProperty("err.error", undefined);
      expect(structuredClone(result)).toEqual(result);
      expect(validate).not.toHaveBeenCalled();
      expect(engine.blockSerializedCache.get(signedRoot)).toBe(entry);
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
      engine.validateGossipBlockBytes(
        computeSignedBlockRoot(ForkName.gloas, block),
        ssz.gloas.SignedBeaconBlock.serialize(block),
        ForkName.gloas,
        0
      )
    ).resolves.toMatchObject({err: {status: "ignore", code: "UNEXPECTED_ERROR"}});
    expect(engine.blockSerializedCache.get(signedRoot)).toBeUndefined();
    expect(engine.logger.error).toHaveBeenCalledWith(
      "Error validating gossip block",
      {root, code: "UNEXPECTED_ERROR"},
      error
    );
  });

  it("retains API observations on validation failure and preserves an existing envelope candidate", async () => {
    vi.spyOn(blockValidation, "validateGossipBlock").mockResolvedValue({skippedSlots: 0});
    await engine.validateGossipBlockBytes(
      computeSignedBlockRoot(ForkName.gloas, block),
      ssz.gloas.SignedBeaconBlock.serialize(block),
      ForkName.gloas
    );
    const input = engine.seenPayloadEnvelopeInputCache.get(root);
    expect(input).toBeDefined();
    const envelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
    envelope.message.beaconBlockRoot = ssz.gloas.BeaconBlock.hashTreeRoot(block.message);
    input?.addPayloadEnvelope({envelope, source: PayloadEnvelopeInputSource.api, seenTimestampSec: 1});
    vi.mocked(blockValidation.validateGossipBlock).mockRejectedValue(
      new BlockGossipError(GossipAction.REJECT, {code: BlockErrorCode.PROPOSAL_SIGNATURE_INVALID, slot: 1, root})
    );
    expect(
      (
        await engine.validateGossipBlockBytes(
          computeSignedBlockRoot(ForkName.gloas, block),
          ssz.gloas.SignedBeaconBlock.serialize(block),
          ForkName.gloas
        )
      ).err?.status
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
      engine.verifyBlocksBytes(
        blocks.map((block) => ({
          signedBlockRoot: computeSignedBlockRoot(ForkName.gloas, block),
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
    await expect(
      engine.verifyAndObserveBlockProposerBytes(ssz.gloas.SignedBeaconBlock.serialize(block), root)
    ).rejects.toThrow("invalid proposer signature");
    expect(engine.seenPayloadEnvelopeInputCache.get(root)?.proposerIndex).toBe(7);
  });

  it("does not create payload inputs for pre-Gloas blocks", async () => {
    vi.spyOn(blockValidation, "validateGossipBlock").mockResolvedValue({skippedSlots: 0});
    const block = ssz.phase0.SignedBeaconBlock.defaultValue();
    await engine.validateGossipBlockBytes(
      computeSignedBlockRoot(ForkName.phase0, block),
      ssz.phase0.SignedBeaconBlock.serialize(block),
      ForkName.phase0
    );
    expect(engine.seenPayloadEnvelopeInputCache.size()).toBe(0);
  });
});
