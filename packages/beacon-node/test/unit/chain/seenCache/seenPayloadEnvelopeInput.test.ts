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
import {config, generateBlock} from "../../../utils/blocksAndData.js";

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
      isDescendant: vi.fn().mockReturnValue(false),
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

    // Only the older entries are ancestors
    vi.mocked(forkChoice.isDescendant).mockImplementation((ancestorRoot) => ancestorRoot === oldRootHex);
    cache.pruneBelowParent(parentBlock);

    expect(cache.get(oldRootHex)).toBeUndefined();
    expect(cache.get(newRootHex)).toBeDefined();
  });

  it("pruneBelowParent keeps payload inputs at the parent slot", () => {
    const rootHex = addPayloadInput(1);
    const parentBlock = protoBlock(rootHex, 1);

    vi.mocked(forkChoice.isDescendant).mockReturnValue(true);
    cache.pruneBelowParent(parentBlock);

    expect(cache.get(rootHex)).toBeDefined();
  });

  it("pruneBelowParent leaves non-ancestor entries on forks alone", () => {
    const forkRootHex = addPayloadInput(1);
    const headRootHex = addPayloadInput(2);
    const parentBlock = protoBlock(headRootHex, 2);

    vi.mocked(forkChoice.isDescendant).mockReturnValue(false);
    cache.pruneBelowParent(parentBlock);

    expect(cache.get(forkRootHex)).toBeDefined();
    expect(cache.get(headRootHex)).toBeDefined();
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
});
