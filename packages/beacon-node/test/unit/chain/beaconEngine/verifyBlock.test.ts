import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {ExecutionStatus} from "@lodestar/fork-choice";
import {ForkName} from "@lodestar/params";
import {BeaconStateView, DataAvailabilityStatus} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {defer, toRootHex} from "@lodestar/utils";
import {BeaconEngine} from "../../../../src/chain/beaconEngine/beaconEngine.js";
import {
  BlockInputBlobs,
  BlockInputNoData,
  BlockInputPreData,
} from "../../../../src/chain/blocks/blockInput/blockInput.js";
import {BlockInputSource} from "../../../../src/chain/blocks/blockInput/index.js";
import {verifyBlocksInEpoch} from "../../../../src/chain/blocks/verifyBlock.js";
import {
  verifyBlockExecutionPayload,
  verifyBlocksExecutionPayload,
} from "../../../../src/chain/blocks/verifyBlocksExecutionPayloads.js";
import * as signatureVerification from "../../../../src/chain/blocks/verifyBlocksSignatures.js";
import * as stf from "../../../../src/chain/blocks/verifyBlocksStateTransitionOnly.js";
import {BlockErrorCode} from "../../../../src/chain/errors/index.js";
import {ExecutionPayloadStatus} from "../../../../src/execution/engine/interface.js";
import {kzgCommitmentToVersionedHash} from "../../../../src/util/blobs.js";
import {getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";
import {generateCachedBellatrixState, zeroProtoBlock} from "../../../utils/state.js";

function bellatrixInput(enabled = false) {
  const block = ssz.bellatrix.SignedBeaconBlock.defaultValue();
  if (enabled) block.message.body.executionPayload.blockHash = Buffer.alloc(32, 1);
  return BlockInputPreData.createFromBlock({
    block,
    blockRootHex: toRootHex(ssz.bellatrix.BeaconBlock.hashTreeRoot(block.message)),
    forkName: ForkName.bellatrix,
    daOutOfRange: false,
    source: BlockInputSource.gossip,
    seenTimestampSec: 0,
  });
}

describe("BeaconEngine block execution verification", () => {
  let chain: ReturnType<typeof getMockedBeaconChain>;
  let state: BeaconStateView;

  beforeEach(() => {
    chain = getMockedBeaconChain();
    const cachedState = generateCachedBellatrixState();
    cachedState.latestExecutionPayloadHeader = ssz.bellatrix.ExecutionPayloadHeader.toViewDU(
      ssz.bellatrix.ExecutionPayloadHeader.defaultValue()
    );
    state = new BeaconStateView(cachedState);
    Object.defineProperty(chain.beaconEngine, "verifiedBlocks", {value: new Map(), configurable: true});
    Object.defineProperty(chain, "serializedCache", {value: new Map(), configurable: true});
    chain.forkChoice.validateLatestHash = vi.fn();
    chain.regen.getPreState.mockResolvedValue(state);
    chain.beaconEngine.verifyBlocks = vi.fn(BeaconEngine.prototype.verifyBlocks.bind(chain.beaconEngine));
    chain.executionEngine.notifyNewPayload = vi.fn().mockResolvedValue({
      status: ExecutionPayloadStatus.VALID,
      latestValidHash: toRootHex(Buffer.alloc(32, 1)),
      validationError: null,
    });
    vi.spyOn(stf, "verifyBlocksStateTransitionOnly").mockResolvedValue({
      postStates: [state],
      proposerBalanceDeltas: [0],
      verifyStateTime: 0,
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("does not submit an empty pre-merge Bellatrix payload", async () => {
    expect(await verifyBlockExecutionPayload(chain, bellatrixInput(), state)).toMatchObject({
      executionStatus: ExecutionStatus.PreMerge,
    });
    expect(chain.executionEngine.notifyNewPayload).not.toHaveBeenCalled();
  });

  it("submits the transition payload when execution becomes enabled", async () => {
    const input = bellatrixInput(true);
    expect(await verifyBlockExecutionPayload(chain, input, state)).toMatchObject({
      executionStatus: ExecutionStatus.Valid,
    });
    expect(chain.executionEngine.notifyNewPayload).toHaveBeenCalledOnce();
  });

  it("derives Deneb hashes from the block even when facade hashes differ", async () => {
    const block = ssz.deneb.SignedBeaconBlock.defaultValue();
    block.message.body.executionPayload.blockHash = Buffer.alloc(32, 1);
    block.message.body.blobKzgCommitments = [Buffer.alloc(48, 2)];
    const input = BlockInputBlobs.createFromBlock({
      block,
      blockRootHex: toRootHex(ssz.deneb.BeaconBlock.hashTreeRoot(block.message)),
      forkName: ForkName.deneb,
      daOutOfRange: false,
      source: BlockInputSource.gossip,
      seenTimestampSec: 0,
    });
    const facadeHashes = vi.spyOn(input, "getVersionedHashes").mockReturnValue([Buffer.alloc(32, 3)]);
    await verifyBlockExecutionPayload(chain, input, state);
    expect(chain.executionEngine.notifyNewPayload).toHaveBeenCalledExactlyOnceWith(
      ForkName.deneb,
      block.message.body.executionPayload,
      block.message.body.blobKzgCommitments.map(kzgCommitmentToVersionedHash),
      block.message.parentRoot,
      undefined
    );
    expect(facadeHashes).not.toHaveBeenCalled();
  });

  it.each([
    [ExecutionPayloadStatus.VALID, ExecutionStatus.Valid],
    [ExecutionPayloadStatus.SYNCING, ExecutionStatus.Syncing],
    [ExecutionPayloadStatus.ACCEPTED, ExecutionStatus.Syncing],
  ] as const)("retains %s status in the engine verification bundle", async (status, expected) => {
    const input = bellatrixInput(true);
    chain.executionEngine.notifyNewPayload.mockResolvedValue(
      status === ExecutionPayloadStatus.VALID
        ? {status, latestValidHash: toRootHex(Buffer.alloc(32, 1)), validationError: null}
        : {status, latestValidHash: null, validationError: null}
    );
    const result = await chain.beaconEngine.verifyBlocks(
      [],
      zeroProtoBlock,
      [input],
      {validSignatures: true},
      new AbortController().signal
    );
    expect(result.segmentExecStatus).toMatchObject({executionStatuses: [expected]});
    expect(chain.beaconEngine.verifiedBlocks.get(input.blockRootHex)?.executionStatus).toBe(expected);
  });

  it("starts STF and signatures while the EL request is pending", async () => {
    const response = defer<Awaited<ReturnType<typeof chain.executionEngine.notifyNewPayload>>>();
    chain.executionEngine.notifyNewPayload.mockReturnValue(response.promise);
    const signatures = vi
      .spyOn(signatureVerification, "verifyBlocksSignatures")
      .mockResolvedValue({verifySignaturesTime: 0});
    const verification = chain.beaconEngine.verifyBlocks(
      [],
      zeroProtoBlock,
      [bellatrixInput(true)],
      {},
      new AbortController().signal
    );
    await vi.waitFor(() => expect(signatures).toHaveBeenCalledOnce());
    expect(stf.verifyBlocksStateTransitionOnly).toHaveBeenCalledOnce();
    expect(chain.beaconEngine.verifiedBlocks.size).toBe(0);
    response.resolve({
      status: ExecutionPayloadStatus.VALID,
      latestValidHash: toRootHex(Buffer.alloc(32, 1)),
      validationError: null,
    });
    await verification;
    expect(chain.beaconEngine.verifiedBlocks.size).toBe(1);
  });

  it("submits a segment sequentially and stops at the first invalid payload", async () => {
    const response = defer<Awaited<ReturnType<typeof chain.executionEngine.notifyNewPayload>>>();
    chain.executionEngine.notifyNewPayload.mockReturnValueOnce(response.promise);
    const verification = verifyBlocksExecutionPayload(
      chain,
      zeroProtoBlock,
      [bellatrixInput(true), bellatrixInput(true)],
      state,
      new AbortController().signal,
      {}
    );
    expect(chain.executionEngine.notifyNewPayload).toHaveBeenCalledOnce();
    response.resolve({status: ExecutionPayloadStatus.INVALID, latestValidHash: null, validationError: "invalid"});
    expect(await verification).toMatchObject({execAborted: {blockIndex: 0}});
    expect(chain.executionEngine.notifyNewPayload).toHaveBeenCalledOnce();
  });

  it("leaves Gloas envelope submission to the facade", async () => {
    const block = ssz.gloas.SignedBeaconBlock.defaultValue();
    const input = BlockInputNoData.createFromBlock({
      block,
      blockRootHex: toRootHex(ssz.gloas.BeaconBlock.hashTreeRoot(block.message)),
      forkName: ForkName.gloas,
      daOutOfRange: false,
      source: BlockInputSource.gossip,
      seenTimestampSec: 0,
    });
    expect(await verifyBlockExecutionPayload(chain, input, state)).toMatchObject({
      executionStatus: ExecutionStatus.Syncing,
    });
    expect(chain.executionEngine.notifyNewPayload).not.toHaveBeenCalled();
  });

  it("skips the EL request when requested", async () => {
    await chain.beaconEngine.verifyBlocks(
      [],
      zeroProtoBlock,
      [bellatrixInput()],
      {validSignatures: true, skipVerifyExecutionPayload: true},
      new AbortController().signal
    );
    expect(chain.executionEngine.notifyNewPayload).not.toHaveBeenCalled();
  });

  it("propagates invalid ancestry inside the engine and rejects without caching", async () => {
    const input = bellatrixInput(true);
    const latestValidHash = toRootHex(Buffer.alloc(32, 2));
    chain.executionEngine.notifyNewPayload.mockResolvedValue({
      status: ExecutionPayloadStatus.INVALID,
      latestValidHash,
      validationError: "invalid",
    });
    await expect(
      chain.beaconEngine.verifyBlocks(
        [],
        {
          ...zeroProtoBlock,
          executionStatus: ExecutionStatus.Syncing,
          executionPayloadBlockHash: toRootHex(Buffer.alloc(32, 4)),
          executionPayloadNumber: 1,
          executionPayloadGasLimit: 30_000_000,
          dataAvailabilityStatus: DataAvailabilityStatus.Available,
        },
        [input],
        {validSignatures: true},
        new AbortController().signal
      )
    ).rejects.toMatchObject({type: {code: BlockErrorCode.EXECUTION_ENGINE_INVALID}});
    expect(chain.forkChoice.validateLatestHash).toHaveBeenCalledWith(
      expect.objectContaining({latestValidExecHash: latestValidHash})
    );
    expect(chain.beaconEngine.verifiedBlocks.size).toBe(0);
  });

  it("does not propagate invalid ancestry when consensus verification fails", async () => {
    const error = new Error("invalid consensus block");
    vi.mocked(stf.verifyBlocksStateTransitionOnly).mockRejectedValue(error);
    chain.executionEngine.notifyNewPayload.mockResolvedValue({
      status: ExecutionPayloadStatus.INVALID,
      latestValidHash: toRootHex(Buffer.alloc(32, 2)),
      validationError: "invalid payload",
    });
    await expect(
      chain.beaconEngine.verifyBlocks(
        [],
        {
          ...zeroProtoBlock,
          executionStatus: ExecutionStatus.Syncing,
          executionPayloadBlockHash: toRootHex(Buffer.alloc(32, 4)),
          executionPayloadNumber: 1,
          executionPayloadGasLimit: 30_000_000,
          dataAvailabilityStatus: DataAvailabilityStatus.Available,
        },
        [bellatrixInput(true)],
        {validSignatures: true},
        new AbortController().signal
      )
    ).rejects.toBe(error);
    expect(chain.forkChoice.validateLatestHash).not.toHaveBeenCalled();
    expect(chain.beaconEngine.verifiedBlocks.size).toBe(0);
  });

  it("aborts the facade DA wait when the engine EL request rejects", async () => {
    const block = ssz.deneb.SignedBeaconBlock.defaultValue();
    block.message.body.executionPayload.blockHash = Buffer.alloc(32, 1);
    block.message.body.blobKzgCommitments = [Buffer.alloc(48, 2)];
    const input = BlockInputBlobs.createFromBlock({
      block,
      blockRootHex: toRootHex(ssz.deneb.BeaconBlock.hashTreeRoot(block.message)),
      forkName: ForkName.deneb,
      daOutOfRange: false,
      source: BlockInputSource.gossip,
      seenTimestampSec: 0,
    });
    const error = new Error("EL disconnected");
    chain.executionEngine.notifyNewPayload.mockRejectedValue(error);
    const waitingForData = vi.spyOn(input, "waitForAllData");
    await expect(verifyBlocksInEpoch.call(chain, zeroProtoBlock, [input], null, {validSignatures: true})).rejects.toBe(
      error
    );
    expect(waitingForData).toHaveBeenCalledOnce();
    expect(waitingForData.mock.calls[0][1]?.aborted).toBe(true);
    expect(chain.beaconEngine.verifiedBlocks.size).toBe(0);
  });
});
