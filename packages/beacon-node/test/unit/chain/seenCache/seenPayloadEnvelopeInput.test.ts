import {beforeEach, describe, expect, it, vi} from "vitest";
import {ExecutionStatus, IForkChoice, PayloadStatus, ProtoBlock} from "@lodestar/fork-choice";
import {testLogger} from "@lodestar/logger/test-utils";
import {ForkName} from "@lodestar/params";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {RootHex} from "@lodestar/types";
import {ChainEventEmitter} from "../../../../src/chain/emitter.js";
import {SeenPayloadEnvelopeInput} from "../../../../src/chain/seenCache/seenPayloadEnvelopeInput.js";
import {SerializedCache} from "../../../../src/util/serializedCache.js";
import {getMockedClock} from "../../../mocks/clock.js";
import {config, generateBlock, generateBlockWithColumnSidecars} from "../../../utils/blocksAndData.js";

describe("SeenPayloadEnvelopeInput", () => {
  let cache: SeenPayloadEnvelopeInput;
  let abortController: AbortController;
  let chainEvents: ChainEventEmitter;
  let forkChoice: IForkChoice;
  let serializedCache: SerializedCache;

  beforeEach(() => {
    chainEvents = new ChainEventEmitter();
    abortController = new AbortController();
    forkChoice = {
      getAllAncestorBlocks: vi.fn(),
    } as unknown as IForkChoice;
    serializedCache = new SerializedCache();

    cache = new SeenPayloadEnvelopeInput({
      config,
      clock: getMockedClock(),
      forkChoice,
      chainEvents,
      signal: abortController.signal,
      serializedCache,
      metrics: null,
      logger: testLogger(),
    });
  });

  function addPayloadInput(slot: number): string {
    const {block, rootHex} = generateBlock({forkName: ForkName.gloas, slot});
    cache.add({
      blockRootHex: rootHex,
      block,
      forkName: ForkName.gloas,
      sampledColumns: [],
      custodyColumns: [],
      timeCreatedSec: Date.now() / 1000,
    });
    return rootHex;
  }

  // Block with blob commitments + non-empty sampledColumns and no columns added, so the input
  // reports hasComputedAllData() === false.
  function addPayloadInputNotComputed(slot: number): string {
    const {block, rootHex} = generateBlockWithColumnSidecars({forkName: ForkName.gloas, slot});
    cache.add({
      blockRootHex: rootHex,
      block,
      forkName: ForkName.gloas,
      sampledColumns: [0, 1],
      custodyColumns: [0, 1],
      timeCreatedSec: Date.now() / 1000,
    });
    return rootHex;
  }

  function protoBlock(blockRoot: RootHex, slot: number): ProtoBlock {
    return {
      slot,
      blockRoot,
      parentRoot: blockRoot,
      stateRoot: blockRoot,
      targetRoot: blockRoot,
      justifiedEpoch: 0,
      justifiedRoot: blockRoot,
      finalizedEpoch: 0,
      finalizedRoot: blockRoot,
      unrealizedJustifiedEpoch: 0,
      unrealizedJustifiedRoot: blockRoot,
      unrealizedFinalizedEpoch: 0,
      unrealizedFinalizedRoot: blockRoot,
      timeliness: false,
      ptcTimeliness: false,
      proposerIndex: 0,
      executionPayloadBlockHash: null,
      executionStatus: ExecutionStatus.PreMerge,
      dataAvailabilityStatus: DataAvailabilityStatus.PreData,
      payloadStatus: PayloadStatus.FULL,
      parentBlockHash: null,
    };
  }

  it("pruneBelowParent removes ancestor payload inputs below the parent slot", () => {
    const oldRootHex = addPayloadInput(1);
    const newRootHex = addPayloadInput(2);
    const parentBlock = protoBlock(newRootHex, 2);

    vi.mocked(forkChoice.getAllAncestorBlocks).mockReturnValue([parentBlock, protoBlock(oldRootHex, 1)]);
    cache.pruneBelowParent(parentBlock);

    expect(cache.get(oldRootHex)).toBeUndefined();
    expect(cache.get(newRootHex)).toBeDefined();
  });

  it("pruneBelowParent keeps ancestor payload inputs whose payload is not yet FULL", () => {
    const oldRootHex = addPayloadInput(1);
    const newRootHex = addPayloadInput(2);
    const parentBlock = protoBlock(newRootHex, 2);
    const emptyAncestor: ProtoBlock = {...protoBlock(oldRootHex, 1), payloadStatus: PayloadStatus.EMPTY};

    vi.mocked(forkChoice.getAllAncestorBlocks).mockReturnValue([parentBlock, emptyAncestor]);
    cache.pruneBelowParent(parentBlock);

    expect(cache.get(oldRootHex)).toBeDefined();
  });

  it("pruneBelowParent keeps ancestor payload inputs that have not computed all data", () => {
    const oldRootHex = addPayloadInputNotComputed(1);
    const newRootHex = addPayloadInput(2);
    // precondition: the ancestor input is still gathering columns
    expect(cache.get(oldRootHex)?.hasComputedAllData()).toBe(false);

    const parentBlock = protoBlock(newRootHex, 2);
    vi.mocked(forkChoice.getAllAncestorBlocks).mockReturnValue([parentBlock, protoBlock(oldRootHex, 1)]);
    cache.pruneBelowParent(parentBlock);

    expect(cache.get(oldRootHex)).toBeDefined();
  });

  it("pruneBelowParent keeps payload inputs at the parent slot", () => {
    const rootHex = addPayloadInput(1);
    const parentBlock = protoBlock(rootHex, 1);

    vi.mocked(forkChoice.getAllAncestorBlocks).mockReturnValue([parentBlock]);
    cache.pruneBelowParent(parentBlock);

    expect(cache.get(rootHex)).toBeDefined();
  });

  it("add returns the existing entry on duplicate root", () => {
    const {block, rootHex} = generateBlock({forkName: ForkName.gloas, slot: 1});
    const props = {
      blockRootHex: rootHex,
      block,
      forkName: ForkName.gloas,
      sampledColumns: [],
      custodyColumns: [],
      timeCreatedSec: Date.now() / 1000,
    };

    const first = cache.add(props);
    const second = cache.add(props);

    expect(second).toBe(first);
    expect(cache.size()).toBe(1);
  });

  it("prune removes a single entry by root and leaves others", () => {
    const rootHex1 = addPayloadInput(1);
    const rootHex2 = addPayloadInput(2);

    cache.prune(rootHex1);

    expect(cache.get(rootHex1)).toBeUndefined();
    expect(cache.get(rootHex2)).toBeDefined();
    expect(cache.size()).toBe(1);
  });

  it("prune is a no-op for an unknown root", () => {
    const rootHex = addPayloadInput(1);

    expect(() => cache.prune(`0x${"ab".repeat(32)}`)).not.toThrow();
    expect(cache.get(rootHex)).toBeDefined();
    expect(cache.size()).toBe(1);
  });
});
