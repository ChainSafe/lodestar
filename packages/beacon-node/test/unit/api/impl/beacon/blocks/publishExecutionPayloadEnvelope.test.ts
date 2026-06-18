import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {when} from "vitest-when";
import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {PayloadStatus} from "@lodestar/fork-choice";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {getBeaconBlockApi} from "../../../../../../src/api/impl/beacon/blocks/index.js";
import {
  ExecutionPayloadEnvelopeError,
  ExecutionPayloadEnvelopeErrorCode,
  GossipAction,
} from "../../../../../../src/chain/errors/index.js";
import {validateApiExecutionPayloadEnvelope} from "../../../../../../src/chain/validation/executionPayloadEnvelope.js";
import {ApiTestModules, getApiTestModules} from "../../../../../utils/api.js";
import {generateProtoBlock} from "../../../../../utils/typeGenerator.js";

vi.mock("../../../../../../src/chain/validation/executionPayloadEnvelope.js", async (importActual) => {
  const mod = await importActual<typeof import("../../../../../../src/chain/validation/executionPayloadEnvelope.js")>();
  return {...mod, validateApiExecutionPayloadEnvelope: vi.fn()};
});

const gloasConfig = createChainForkConfig({
  ...defaultChainConfig,
  GLOAS_FORK_EPOCH: 0,
});

describe("api - beacon - publishExecutionPayloadEnvelope", () => {
  let modules: ApiTestModules;
  let api: ReturnType<typeof getBeaconBlockApi>;

  const slot = 1;
  const blockRoot = Buffer.alloc(32, 1);
  const blockHash = Buffer.alloc(32, 2);
  const blockRootHex = toRootHex(blockRoot);
  const blockHashHex = toRootHex(blockHash);

  function buildEnvelope(beaconBlockRoot: Uint8Array, payloadBlockHash: Uint8Array) {
    const signed = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
    signed.message.beaconBlockRoot = beaconBlockRoot;
    signed.message.payload.slotNumber = slot;
    signed.message.payload.blockHash = payloadBlockHash;
    return signed;
  }

  const signedEnvelope = buildEnvelope(blockRoot, blockHash);

  function makeInput(opts: {hasEnvelope: boolean; storedEnvelope?: ReturnType<typeof buildEnvelope>}) {
    return {
      hasPayloadEnvelope: vi.fn().mockReturnValue(opts.hasEnvelope),
      getPayloadEnvelope: vi.fn().mockReturnValue(opts.storedEnvelope ?? signedEnvelope),
      addPayloadEnvelope: vi.fn(),
      addColumn: vi.fn(),
    };
  }

  function throwAlreadyKnown(): void {
    vi.mocked(validateApiExecutionPayloadEnvelope).mockRejectedValue(
      new ExecutionPayloadEnvelopeError(GossipAction.IGNORE, {
        code: ExecutionPayloadEnvelopeErrorCode.ENVELOPE_ALREADY_KNOWN,
        blockRoot: blockRootHex,
        slot,
      })
    );
  }

  beforeEach(() => {
    modules = getApiTestModules({config: gloasConfig});
    api = getBeaconBlockApi(modules);

    when(modules.forkChoice.getBlockHex)
      .calledWith(blockRootHex, PayloadStatus.EMPTY)
      .thenReturn(generateProtoBlock({slot}));

    (modules.network as any).publishSignedExecutionPayloadEnvelope = vi.fn().mockResolvedValue(1);
    modules.chain.processExecutionPayload = vi.fn().mockResolvedValue(undefined) as any;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("happy path: unknown envelope is added and published (200)", async () => {
    vi.mocked(validateApiExecutionPayloadEnvelope).mockResolvedValue(undefined);
    const input = makeInput({hasEnvelope: false});
    modules.chain.seenPayloadEnvelopeInputCache.get.mockReturnValue(input as any);

    await expect(
      api.publishExecutionPayloadEnvelope({signedExecutionPayloadEnvelope: signedEnvelope})
    ).resolves.toBeUndefined();

    expect(input.addPayloadEnvelope).toHaveBeenCalledTimes(1);
    expect(modules.chain.processExecutionPayload).toHaveBeenCalledTimes(1);
    expect(modules.network.publishSignedExecutionPayloadEnvelope).toHaveBeenCalledTimes(1);
  });

  it("VC retry: envelope already in cache → 200, not added again", async () => {
    throwAlreadyKnown();
    const input = makeInput({hasEnvelope: true}); // same block hash as incoming
    modules.chain.seenPayloadEnvelopeInputCache.get.mockReturnValue(input as any);

    await expect(
      api.publishExecutionPayloadEnvelope({signedExecutionPayloadEnvelope: signedEnvelope})
    ).resolves.toBeUndefined();

    expect(input.addPayloadEnvelope).not.toHaveBeenCalled();
    expect(modules.chain.processExecutionPayload).not.toHaveBeenCalled();
    expect(modules.network.publishSignedExecutionPayloadEnvelope).not.toHaveBeenCalled();
    expect(modules.chain.logger.debug).toHaveBeenCalledWith(
      "Execution payload envelope already known, skipping duplicate",
      expect.objectContaining({slot, blockRoot: blockRootHex})
    );
    expect(modules.chain.logger.warn).not.toHaveBeenCalled();
  });

  it("gossip-first: already known, cache pruned → 200 (null-safe lookup)", async () => {
    throwAlreadyKnown();
    modules.chain.seenPayloadEnvelopeInputCache.get.mockReturnValue(undefined); // pruned

    await expect(
      api.publishExecutionPayloadEnvelope({signedExecutionPayloadEnvelope: signedEnvelope})
    ).resolves.toBeUndefined();

    expect(modules.chain.processExecutionPayload).not.toHaveBeenCalled();
    expect(modules.network.publishSignedExecutionPayloadEnvelope).not.toHaveBeenCalled();
    expect(modules.chain.logger.debug).toHaveBeenCalledWith(
      "Execution payload envelope already known, skipping duplicate",
      expect.objectContaining({slot, blockRoot: blockRootHex})
    );
    expect(modules.chain.logger.warn).not.toHaveBeenCalled();
  });

  it("divergent hash: known envelope with a DIFFERENT block hash → warn + 200", async () => {
    throwAlreadyKnown();
    const stored = buildEnvelope(blockRoot, Buffer.alloc(32, 0xff));
    const input = makeInput({hasEnvelope: true, storedEnvelope: stored});
    modules.chain.seenPayloadEnvelopeInputCache.get.mockReturnValue(input as any);

    await expect(
      api.publishExecutionPayloadEnvelope({signedExecutionPayloadEnvelope: signedEnvelope})
    ).resolves.toBeUndefined();

    expect(modules.chain.processExecutionPayload).not.toHaveBeenCalled();
    expect(modules.network.publishSignedExecutionPayloadEnvelope).not.toHaveBeenCalled();
    expect(input.addPayloadEnvelope).not.toHaveBeenCalled();
    expect(modules.chain.logger.warn).toHaveBeenCalledWith(
      "Execution payload envelope already known with a DIFFERENT block hash",
      expect.objectContaining({
        slot,
        blockRoot: blockRootHex,
        existingBlockHash: toRootHex(stored.message.payload.blockHash),
        newBlockHash: blockHashHex,
      })
    );
  });

  it("race path: envelope set between validation and the guard → not added twice, still published", async () => {
    vi.mocked(validateApiExecutionPayloadEnvelope).mockResolvedValue(undefined);
    const input = makeInput({hasEnvelope: true});
    modules.chain.seenPayloadEnvelopeInputCache.get.mockReturnValue(input as any);

    await expect(
      api.publishExecutionPayloadEnvelope({signedExecutionPayloadEnvelope: signedEnvelope})
    ).resolves.toBeUndefined();

    expect(input.addPayloadEnvelope).not.toHaveBeenCalled();
    expect(modules.chain.processExecutionPayload).toHaveBeenCalledTimes(1);
    expect(modules.network.publishSignedExecutionPayloadEnvelope).toHaveBeenCalledTimes(1);
  });
});
