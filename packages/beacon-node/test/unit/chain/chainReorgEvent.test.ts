import {assert, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {createChainForkConfig} from "@lodestar/config";
import {
  ExecutionStatus,
  ForkChoice,
  ForkChoiceStore,
  PayloadStatus,
  ProtoArray,
  ProtoBlock,
} from "@lodestar/fork-choice";
import {DataAvailabilityStatus, getEffectiveBalanceIncrementsZeroed} from "@lodestar/state-transition";
import {fromHex, toRootHex} from "@lodestar/utils";
import {BeaconChain} from "../../../src/chain/chain.js";
import {ChainEventEmitter, ReorgEventData} from "../../../src/chain/emitter.js";
import {ForkchoiceCaller} from "../../../src/chain/forkChoice/index.js";
import {getMockedLogger} from "../../mocks/loggerMock.js";
import {generateProtoBlock} from "../../utils/typeGenerator.js";

vi.unmock("@lodestar/fork-choice");

function setup() {
  const config = createChainForkConfig({GLOAS_FORK_EPOCH: 0});
  const root = (value: number): string => toRootHex(Buffer.alloc(32, value));
  const anchor = generateProtoBlock({
    blockRoot: root(1),
    executionPayloadBlockHash: root(2),
    executionPayloadNumber: 0,
    executionPayloadGasLimit: 30_000_000,
    executionStatus: ExecutionStatus.Valid,
  });
  const protoArray = ProtoArray.initialize(anchor, 0);
  const checkpoint = {epoch: 0, root: fromHex(anchor.blockRoot)};
  const balances = getEffectiveBalanceIncrementsZeroed(0);
  const store = new ForkChoiceStore(
    0,
    checkpoint,
    checkpoint,
    balances,
    () => balances,
    () => null
  );
  const forkChoice = new ForkChoice(config, store, protoArray, 0, null);

  function addBlock(slot: number, parent: ProtoBlock) {
    const parentHash = parent.executionPayloadBlockHash;
    assert(parentHash !== null);
    const block = generateProtoBlock({
      slot,
      blockRoot: root(10 + slot),
      stateRoot: root(20 + slot),
      parentRoot: parent.blockRoot,
      parentBlockHash: parentHash,
      executionPayloadBlockHash: parentHash,
      executionPayloadNumber: slot,
      executionPayloadGasLimit: 30_000_000,
      executionStatus: ExecutionStatus.Valid,
      payloadStatus: PayloadStatus.PENDING,
    });
    protoArray.onBlock(block, slot, null);
    protoArray.onExecutionPayload(
      block.blockRoot,
      slot,
      root(30 + slot),
      slot,
      30_000_000,
      null,
      ExecutionStatus.Valid,
      DataAvailabilityStatus.Available
    );
    const empty = protoArray.getNode(block.blockRoot, PayloadStatus.EMPTY);
    const full = protoArray.getNode(block.blockRoot, PayloadStatus.FULL);
    assert(empty && full);
    return {empty, full};
  }

  const parent = addBlock(1, anchor);
  const childOnFull = addBlock(2, parent.full);
  const childOnEmpty = addBlock(3, parent.empty);
  const grandchildOnEmpty = addBlock(4, childOnEmpty.full);
  const blocks = {parent, childOnFull, childOnEmpty, grandchildOnEmpty};
  const emitter = new ChainEventEmitter();
  const events: ReorgEventData[] = [];
  emitter.on(routes.events.EventType.chainReorg, (data) => events.push(data));
  const chain = Object.assign(Object.create(BeaconChain.prototype) as BeaconChain, {
    config,
    forkChoice,
    emitter,
    logger: getMockedLogger(),
    metrics: null,
  });
  vi.spyOn(forkChoice, "getDependentRoot").mockReturnValue(anchor.blockRoot);

  function updateHead(previous: ProtoBlock, head: ProtoBlock) {
    vi.spyOn(forkChoice, "getHead").mockReturnValue(previous);
    vi.spyOn(forkChoice, "updateAndGetHead").mockReturnValue({head});
    chain.recomputeForkChoiceHead(ForkchoiceCaller.importBlock);
  }

  return {blocks, forkChoice, events, updateHead};
}

describe("BeaconChain chain_reorg event", () => {
  it.each<
    [
      name: string,
      oldBlock: keyof ReturnType<typeof setup>["blocks"],
      oldStatus: "empty" | "full",
      newBlock: keyof ReturnType<typeof setup>["blocks"],
      newStatus: "empty" | "full",
      depth: number | null,
    ]
  >([
    ["same-root payload removal", "parent", "full", "parent", "empty", 0],
    ["child excludes old payload", "parent", "full", "childOnEmpty", "empty", 0],
    ["child replaces old payload", "parent", "full", "childOnEmpty", "full", 0],
    ["later descendant excludes old payload", "parent", "full", "grandchildOnEmpty", "full", 0],
    ["payload arrival", "parent", "empty", "parent", "full", null],
    ["child extends empty head", "parent", "empty", "childOnEmpty", "full", null],
    ["child includes previously unselected payload", "parent", "empty", "childOnFull", "full", null],
    ["normal payload extension", "parent", "full", "childOnFull", "full", null],
    ["beacon extension without new payload", "parent", "full", "childOnFull", "empty", null],
    ["unchanged head", "parent", "full", "parent", "full", null],
    ["beacon reorg", "childOnFull", "full", "childOnEmpty", "full", 2],
    ["rollback from empty head drops earlier payload", "childOnFull", "empty", "parent", "empty", 1],
  ])("%s", (_name, oldBlock, oldStatus, newBlock, newStatus, depth) => {
    const {blocks, events, updateHead} = setup();
    const previous = blocks[oldBlock][oldStatus];
    const head = blocks[newBlock][newStatus];
    updateHead(previous, head);

    expect(events).toEqual(
      depth === null
        ? []
        : [
            {
              slot: head.slot,
              depth,
              oldHeadHash: previous.executionPayloadBlockHash,
              oldHeadBlock: previous.blockRoot,
              newHeadHash: head.executionPayloadBlockHash,
              newHeadBlock: head.blockRoot,
              oldHeadState: previous.stateRoot,
              newHeadState: head.stateRoot,
              epoch: 0,
              executionOptimistic: false,
            },
          ]
    );
  });

  it("emits even if duty dependent roots are unavailable", () => {
    const {blocks, forkChoice, events, updateHead} = setup();
    vi.mocked(forkChoice.getDependentRoot).mockImplementation(() => {
      throw Error("No block for root");
    });
    updateHead(blocks.parent.full, blocks.parent.empty);
    expect(events).toHaveLength(1);
  });
});
