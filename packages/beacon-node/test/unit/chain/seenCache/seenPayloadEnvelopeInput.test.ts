import {beforeEach, describe, expect, it} from "vitest";
import {testLogger} from "@lodestar/logger/test-utils";
import {ForkName} from "@lodestar/params";
import {ChainEventEmitter} from "../../../../src/chain/emitter.js";
import {SeenPayloadEnvelopeInput} from "../../../../src/chain/seenCache/seenPayloadEnvelopeInput.js";
import {SerializedCache} from "../../../../src/util/serializedCache.js";
import {getMockedClock} from "../../../mocks/clock.js";
import {config, generateBlock} from "../../../utils/blocksAndData.js";

describe("SeenPayloadEnvelopeInput", () => {
  let cache: SeenPayloadEnvelopeInput;
  let abortController: AbortController;
  let chainEvents: ChainEventEmitter;
  let serializedCache: SerializedCache;

  beforeEach(() => {
    chainEvents = new ChainEventEmitter();
    abortController = new AbortController();
    serializedCache = new SerializedCache();

    cache = new SeenPayloadEnvelopeInput({
      config,
      clock: getMockedClock(),
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

  it("pruneBelow removes payload inputs below the cutoff slot", () => {
    const oldRootHex = addPayloadInput(1);
    const newRootHex = addPayloadInput(2);

    cache.pruneBelow(2);

    expect(cache.get(oldRootHex)).toBeUndefined();
    expect(cache.get(newRootHex)).toBeDefined();
  });

  it("pruneBelow keeps payload inputs at or above the cutoff slot", () => {
    const rootHex = addPayloadInput(1);

    cache.pruneBelow(1);

    expect(cache.get(rootHex)).toBeDefined();
  });
});
