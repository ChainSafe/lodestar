import {setImmediate as yieldToIO} from "node:timers/promises";
import {generateKeyPair} from "@libp2p/crypto/keys";
import {describe, expect, it, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {config as defaultConfig} from "@lodestar/config/default";
import {testLogger} from "@lodestar/logger/test-utils";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {defer} from "@lodestar/utils";
import {INetworkCore} from "../../../src/network/core/types.js";
import {NetworkEventBus} from "../../../src/network/events.js";
import {Network} from "../../../src/network/network.js";
import {defaultNetworkOptions} from "../../../src/network/options.js";
import {AggregatorTracker} from "../../../src/network/processor/aggregatorTracker.js";
import {NetworkProcessor} from "../../../src/network/processor/index.js";
import {ClockStopped} from "../../mocks/clock.js";
import {getMockedBeaconChain} from "../../mocks/mockedBeaconChain.js";
import {getMockedBeaconDb} from "../../mocks/mockedBeaconDb.js";

async function fixture(close: () => Promise<void>, config = createBeaconConfig(defaultConfig, new Uint8Array(32))) {
  const clock = new ClockStopped(0);
  const chain = {...getMockedBeaconChain(), clock, config, getStatus: vi.fn(() => ssz.fulu.Status.defaultValue())};
  const events = new NetworkEventBus();
  const logger = testLogger();
  const aggregatorTracker = new AggregatorTracker();
  const publishGossip = vi.fn(async () => 0);
  const updateStatus = vi.fn<INetworkCore["updateStatus"]>().mockResolvedValue(undefined);
  const setTargetGroupCount = vi.fn<INetworkCore["setTargetGroupCount"]>().mockResolvedValue(undefined);
  const core = {close, publishGossip, updateStatus, setTargetGroupCount} as unknown as INetworkCore;
  const networkProcessor = new NetworkProcessor(
    {chain, db: getMockedBeaconDb(), config, logger, metrics: null, events, core, aggregatorTracker},
    {}
  );
  const network = new Network({
    opts: defaultNetworkOptions,
    privateKey: await generateKeyPair("secp256k1"),
    config,
    chain,
    logger,
    networkEventBus: events,
    networkProcessor,
    core,
    aggregatorTracker,
  });
  return {network, events, chain, clock, publishGossip, updateStatus, setTargetGroupCount, logger};
}

describe("network publication completion", () => {
  it.each([
    {firstFails: false, lastFails: false},
    {firstFails: false, lastFails: true},
    {firstFails: true, lastFails: false},
    {firstFails: true, lastFails: true},
  ])(
    "waits for every fork publication (first fails: $firstFails, last fails: $lastFails)",
    async ({firstFails, lastFails}) => {
      const config = createBeaconConfig(
        {
          ...defaultConfig,
          ALTAIR_FORK_EPOCH: 0,
          BELLATRIX_FORK_EPOCH: 0,
          CAPELLA_FORK_EPOCH: 0,
          DENEB_FORK_EPOCH: 1,
          ELECTRA_FORK_EPOCH: 2,
          FULU_FORK_EPOCH: 3,
          GLOAS_FORK_EPOCH: 4,
          HEZE_FORK_EPOCH: 5,
        },
        new Uint8Array(32)
      );
      const {network, clock, publishGossip} = await fixture(async () => {}, config);
      clock.setSlot(3 * SLOTS_PER_EPOCH);
      const last = defer<number>();
      if (firstFails) publishGossip.mockRejectedValueOnce(new Error("first fork refused"));
      else publishGossip.mockResolvedValueOnce(3);
      publishGossip.mockReturnValue(last.promise);
      const finished = vi.fn();
      const published = network.publishBlsToExecutionChange(ssz.capella.SignedBLSToExecutionChange.defaultValue());
      void published.then(finished, finished);
      try {
        await yieldToIO();
        expect(publishGossip).toHaveBeenCalledTimes(6);
        expect(finished).not.toHaveBeenCalled();
        if (lastFails) last.reject(new Error("second fork refused"));
        else last.resolve(4);
        if (firstFails && lastFails) await expect(published).rejects.toBeInstanceOf(AggregateError);
        else await expect(published).resolves.toBe(firstFails ? 4 : 3);
      } finally {
        last.resolve(0);
        await Promise.allSettled([published]);
        await network.close();
      }
    }
  );
});
