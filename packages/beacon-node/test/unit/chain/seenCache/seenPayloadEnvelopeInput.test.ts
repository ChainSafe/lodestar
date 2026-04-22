import {beforeEach, describe, expect, it} from "vitest";
import {testLogger} from "@lodestar/logger/test-utils";
import {ForkName} from "@lodestar/params";
import {ChainEventEmitter} from "../../../../src/chain/emitter.js";
import {SeenPayloadEnvelopeInput} from "../../../../src/chain/seenCache/seenPayloadEnvelopeInput.js";
import {SerializedCache} from "../../../../src/util/serializedCache.js";
import {generateBlock} from "../../../utils/blocksAndData.js";

describe("SeenPayloadEnvelopeInput", () => {
  let cache: SeenPayloadEnvelopeInput;
  let abortController: AbortController;
  let chainEvents: ChainEventEmitter;
  let serializedCache: SerializedCache;
  let validatedRoots: Set<string>;

  beforeEach(() => {
    chainEvents = new ChainEventEmitter();
    abortController = new AbortController();
    serializedCache = new SerializedCache();
    validatedRoots = new Set();

    cache = new SeenPayloadEnvelopeInput({
      chainEvents,
      signal: abortController.signal,
      serializedCache,
      hasValidatedPayload: (blockRootHex) => validatedRoots.has(blockRootHex),
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

  it("prune removes an explicit payload input", () => {
    const rootHex = addPayloadInput(1);

    expect(cache.get(rootHex)).toBeDefined();

    cache.prune(rootHex);

    expect(cache.get(rootHex)).toBeUndefined();
  });

  it("pruneBelow keeps older payload inputs until their payload is validated", () => {
    const rootHex = addPayloadInput(1);

    cache.pruneBelow(2);

    expect(cache.get(rootHex)).toBeDefined();
  });

  it("pruneBelow removes older payload inputs once their payload is validated", () => {
    const rootHex = addPayloadInput(1);
    validatedRoots.add(rootHex);

    cache.pruneBelow(2);

    expect(cache.get(rootHex)).toBeUndefined();
  });
});
