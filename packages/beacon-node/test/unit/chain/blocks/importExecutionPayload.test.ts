import {afterEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {createChainForkConfig} from "@lodestar/config";
import {ExecutionStatus, IForkChoice, PayloadStatus, ProtoBlock} from "@lodestar/fork-choice";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {RootHex, Slot} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";
import {importExecutionPayload} from "../../../../src/chain/blocks/importExecutionPayload.js";
import {PayloadEnvelopeInputSource} from "../../../../src/chain/blocks/payloadEnvelopeInput/index.js";
import {BeaconChain} from "../../../../src/chain/chain.js";
import {ChainEventEmitter} from "../../../../src/chain/emitter.js";
import {PayloadEnvelopeInput} from "../../../../src/chain/seenCache/seenPayloadEnvelopeInput.js";
import {ExecutionPayloadStatus} from "../../../../src/execution/index.js";
import {getMockedLogger} from "../../../mocks/loggerMock.js";
import {generateProtoBlock} from "../../../utils/typeGenerator.js";

vi.mock("../../../../src/chain/blocks/verifyExecutionPayloadEnvelope.js", () => ({
  verifyExecutionPayloadEnvelope: vi.fn(),
  verifyExecutionPayloadEnvelopeSignature: vi.fn().mockResolvedValue(true),
}));
vi.mock("@lodestar/state-transition", async (importActual) => ({
  ...(await importActual<typeof import("@lodestar/state-transition")>()),
  isStatePostGloas: () => true,
  isStatePostHeze: () => false,
}));

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
  const bRoot = `0x${"22".repeat(32)}`;
  const cRoot = `0x${"33".repeat(32)}`;
  const jHash = `0x${"aa".repeat(32)}`;
  const bHash = `0x${"bb".repeat(32)}`;
  const bSlot = 1;
  const cSlot = 2;

  function toHead(slot: Slot, blockRoot: RootHex, payloadStatus: PayloadStatus): ProtoBlock {
    return generateProtoBlock({
      slot,
      blockRoot,
      stateRoot: blockRoot,
      payloadStatus,
      executionStatus: ExecutionStatus.Valid,
    });
  }

  /** A fork choice whose head moves from `headBefore` to `headAfter` when the payload is imported */
  function setup(headBefore: ProtoBlock, headAfter: ProtoBlock) {
    let head = headBefore;
    const finalizedBlock = generateProtoBlock({slot: 0});
    const forkChoice = {
      getBlockHexDefaultStatus: () =>
        generateProtoBlock({slot: bSlot, blockRoot: bRoot, executionStatus: ExecutionStatus.Syncing}),
      getHead: () => head,
      onExecutionPayload: vi.fn(() => {
        head = headAfter;
      }),
      isPayloadInclusionListSatisfied: () => true,
      getDependentRoot: () => bRoot,
      getConfirmedRoot: () => finalizedBlock.blockRoot,
      getConfirmedBlock: () => finalizedBlock,
      getFinalizedBlock: () => finalizedBlock,
    } as unknown as IForkChoice;

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
      clock: {currentSlot: cSlot, secFromSlot: () => 0},
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
      onHeadChanged,
    } as unknown as BeaconChain;
    const payloadInput = {
      blockRootHex: bRoot,
      getBlockHashHex: () => bHash,
      getVersionedHashes: () => [],
      getPayloadEnvelope: () => ({
        message: {
          builderIndex: 0,
          payload: {slotNumber: bSlot, blockNumber: 1, gasLimit: 30_000_000, parentHash: fromHex(jHash)},
        },
      }),
      getPayloadEnvelopeSource: () => ({source: PayloadEnvelopeInputSource.gossip, seenTimestampSec: 0}),
      getSampledColumnsWithSource: () => [],
    } as unknown as PayloadEnvelopeInput;

    const run = () =>
      importExecutionPayload.call(chain, payloadInput, DataAvailabilityStatus.Available, {validSignature: true});
    return {run, headEvents, notifyForkchoiceUpdate, onHeadChanged};
  }

  function expectForkchoiceUpdate(notifyForkchoiceUpdate: ReturnType<typeof vi.fn>): void {
    expect(notifyForkchoiceUpdate).toHaveBeenCalledExactlyOnceWith(
      "gloas",
      bRoot,
      bHash,
      expect.any(String),
      expect.any(String)
    );
  }

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("emits head_v2 when the head moves to the FULL variant of the same block", async () => {
    const {run, headEvents, notifyForkchoiceUpdate, onHeadChanged} = setup(
      toHead(bSlot, bRoot, PayloadStatus.EMPTY),
      toHead(bSlot, bRoot, PayloadStatus.FULL)
    );

    await run();

    expect(headEvents).toEqual([`head_v2 ${bRoot} full`]);
    expect(onHeadChanged).not.toHaveBeenCalled();
    expectForkchoiceUpdate(notifyForkchoiceUpdate);
  });

  it("applies a head change when the FULL variant overtakes a child built on EMPTY", async () => {
    const prevHead = toHead(cSlot, cRoot, PayloadStatus.EMPTY);
    const newHead = toHead(bSlot, bRoot, PayloadStatus.FULL);
    const {run, headEvents, notifyForkchoiceUpdate, onHeadChanged} = setup(prevHead, newHead);

    await run();

    expect(headEvents).toEqual([`head ${bRoot}`, `head_v2 ${bRoot} full`]);
    expect(onHeadChanged).toHaveBeenCalledExactlyOnceWith(prevHead, newHead);
    expectForkchoiceUpdate(notifyForkchoiceUpdate);
  });

  it("emits nothing and still sends forkchoiceUpdated when the head does not move", async () => {
    const head = toHead(bSlot, bRoot, PayloadStatus.EMPTY);
    const {run, headEvents, notifyForkchoiceUpdate, onHeadChanged} = setup(head, head);

    await run();

    expect(headEvents).toEqual([]);
    expect(onHeadChanged).not.toHaveBeenCalled();
    expectForkchoiceUpdate(notifyForkchoiceUpdate);
  });
});
