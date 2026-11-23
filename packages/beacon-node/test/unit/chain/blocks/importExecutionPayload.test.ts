import {afterEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {createChainForkConfig} from "@lodestar/config";
import {
  ExecutionStatus,
  ForkChoice,
  ForkChoiceStore,
  LVHInvalidJudged,
  PayloadStatus,
  ProtoArray,
  ProtoBlock,
} from "@lodestar/fork-choice";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {RootHex, Slot} from "@lodestar/types";
import {fromHex, toRootHex} from "@lodestar/utils";
import {PayloadErrorCode, importExecutionPayload} from "../../../../src/chain/blocks/importExecutionPayload.js";
import {PayloadEnvelopeInputSource} from "../../../../src/chain/blocks/payloadEnvelopeInput/index.js";
import {BeaconChain} from "../../../../src/chain/chain.js";
import {ChainEventEmitter} from "../../../../src/chain/emitter.js";
import {ExecutionInvalidSource, ForkchoiceCaller} from "../../../../src/chain/forkChoice/index.js";
import {PayloadEnvelopeInput} from "../../../../src/chain/seenCache/seenPayloadEnvelopeInput.js";
import {ExecutionPayloadStatus} from "../../../../src/execution/index.js";
import {getMockedLogger} from "../../../mocks/loggerMock.js";
import {generateProtoBlock} from "../../../utils/typeGenerator.js";

vi.mock("../../../../src/chain/blocks/verifyExecutionPayloadEnvelope.js", () => ({
  verifyExecutionPayloadEnvelope: vi.fn(),
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
      getPayloadEnvelope: () => ({payload: {slotNumber: slot, parentHash}}),
    } as unknown as PayloadEnvelopeInput;
    const run = importExecutionPayload.call(chain, payloadInput, DataAvailabilityStatus.Available, {
      validExecutionRequestsRoot: true,
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

describe("chain / blocks / importExecutionPayload head", () => {
  const config = createChainForkConfig({
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 0,
    CAPELLA_FORK_EPOCH: 0,
    DENEB_FORK_EPOCH: 0,
    ELECTRA_FORK_EPOCH: 0,
    FULU_FORK_EPOCH: 0,
    GLOAS_FORK_EPOCH: 0,
  });
  const validatorCount = 32;
  const jRoot = `0x${"11".repeat(32)}`;
  const bRoot = `0x${"22".repeat(32)}`;
  const cRoot = `0x${"33".repeat(32)}`;
  const jHash = `0x${"aa".repeat(32)}`;
  const bHash = `0x${"bb".repeat(32)}`;
  const bSlot = 1;
  const cSlot = 2;

  function toProtoBlock(slot: Slot, blockRoot: RootHex, parentRoot: RootHex, isGloas: boolean): ProtoBlock {
    return generateProtoBlock({
      slot,
      blockRoot,
      parentRoot,
      stateRoot: blockRoot,
      targetRoot: jRoot,
      justifiedRoot: jRoot,
      finalizedRoot: jRoot,
      unrealizedJustifiedRoot: jRoot,
      unrealizedFinalizedRoot: jRoot,
      // a gloas block's PENDING and EMPTY variants carry the parent hash of its bid, so B and C build on J's payload
      executionPayloadBlockHash: jHash,
      executionPayloadNumber: 0,
      executionStatus: ExecutionStatus.Valid,
      dataAvailabilityStatus: DataAvailabilityStatus.Available,
      parentBlockHash: isGloas ? jHash : null,
    });
  }

  function setup(currentSlot: Slot, withC: boolean) {
    const protoArray = ProtoArray.initialize(toProtoBlock(0, jRoot, `0x${"00".repeat(32)}`, false), currentSlot);
    protoArray.onBlock(toProtoBlock(bSlot, bRoot, jRoot, true), currentSlot, null);
    if (withC) {
      protoArray.onBlock(toProtoBlock(cSlot, cRoot, bRoot, true), currentSlot, null);
    }
    const balances = new Uint16Array(validatorCount).fill(32);
    const checkpoint = {epoch: 0, root: fromHex(jRoot)};
    const store = new ForkChoiceStore(
      currentSlot,
      checkpoint,
      checkpoint,
      balances,
      () => balances,
      () => null
    );
    const forkChoice = new ForkChoice(config, store, protoArray, validatorCount, null);

    const emitter = new ChainEventEmitter();
    const headEvents: string[] = [];
    emitter.on(routes.events.EventType.head, ({block}) => headEvents.push(`head ${block}`));
    emitter.on(routes.events.EventType.headV2, ({data}) =>
      headEvents.push(`head_v2 ${data.block} ${data.payloadStatus}`)
    );
    const notifyForkchoiceUpdate = vi.fn().mockResolvedValue(null);
    const onHeadChanged = vi.fn();
    const chain = {
      config,
      opts: {},
      clock: {currentSlot, secFromSlot: () => 0},
      emitter,
      logger: getMockedLogger(),
      metrics: null,
      forkChoice,
      regen: {getBlockSlotState: vi.fn().mockResolvedValue({})},
      executionEngine: {
        notifyNewPayload: vi.fn().mockResolvedValue({
          status: ExecutionPayloadStatus.VALID,
          latestValidHash: bHash,
          validationError: null,
        }),
        notifyForkchoiceUpdate,
      },
      unfinalizedPayloadEnvelopeWrites: {
        waitForSpace: vi.fn().mockResolvedValue(undefined),
        push: vi.fn().mockResolvedValue(undefined),
      },
      emitHeadEvents: BeaconChain.prototype.emitHeadEvents,
      recomputeForkChoiceHead: BeaconChain.prototype.recomputeForkChoiceHead,
      onHeadChanged,
    } as unknown as BeaconChain;
    const payloadInput = {
      blockRootHex: bRoot,
      getBlockHashHex: () => bHash,
      getVersionedHashes: () => [],
      getBuilderIndex: () => 0,
      getPayloadEnvelope: () => ({
        payload: {slotNumber: bSlot, blockNumber: 1, gasLimit: 30_000_000, parentHash: fromHex(jHash)},
      }),
      getPayloadEnvelopeSource: () => ({source: PayloadEnvelopeInputSource.gossip, seenTimestampSec: 0}),
      getSampledColumnsWithSource: () => [],
    } as unknown as PayloadEnvelopeInput;

    return {chain, forkChoice, payloadInput, headEvents, notifyForkchoiceUpdate, onHeadChanged};
  }

  it("emits head_v2 when the head moves to the FULL variant of the same block", async () => {
    const {chain, forkChoice, payloadInput, headEvents, notifyForkchoiceUpdate, onHeadChanged} = setup(bSlot, false);
    const prevHead = forkChoice.getHead();
    expect(prevHead.payloadStatus).toBe(PayloadStatus.EMPTY);

    await importExecutionPayload.call(chain, payloadInput, DataAvailabilityStatus.Available, {
      validExecutionRequestsRoot: true,
    });

    expect(forkChoice.getHead()).toMatchObject({blockRoot: bRoot, payloadStatus: PayloadStatus.FULL});
    expect(headEvents).toEqual([`head_v2 ${bRoot} full`]);
    expect(onHeadChanged).not.toHaveBeenCalled();
    expect(notifyForkchoiceUpdate).toHaveBeenCalledExactlyOnceWith(
      "gloas",
      bRoot,
      bHash,
      expect.any(String),
      expect.any(String)
    );

    chain.recomputeForkChoiceHead(ForkchoiceCaller.importBlock);
    expect(headEvents).toHaveLength(1);
  });

  it("applies a head change off a child built on the EMPTY variant", async () => {
    const {chain, forkChoice, payloadInput, headEvents, notifyForkchoiceUpdate, onHeadChanged} = setup(cSlot, true);
    const prevHead = forkChoice.getHead();
    expect(prevHead.blockRoot).toBe(cRoot);

    await importExecutionPayload.call(chain, payloadInput, DataAvailabilityStatus.Available, {
      validExecutionRequestsRoot: true,
    });

    const head = forkChoice.getHead();
    expect(head).toMatchObject({blockRoot: bRoot, payloadStatus: PayloadStatus.FULL});
    expect(headEvents).toEqual([`head ${bRoot}`, `head_v2 ${bRoot} full`]);
    expect(onHeadChanged).toHaveBeenCalledExactlyOnceWith(prevHead, head);
    expect(notifyForkchoiceUpdate).toHaveBeenCalledExactlyOnceWith(
      "gloas",
      bRoot,
      bHash,
      expect.any(String),
      expect.any(String)
    );

    chain.recomputeForkChoiceHead(ForkchoiceCaller.importBlock);
    expect(headEvents).toHaveLength(2);
  });
});
