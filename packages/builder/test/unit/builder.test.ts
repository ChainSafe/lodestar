import {describe, expect, it, vi} from "vitest";
import {SecretKey} from "@chainsafe/lodestar-z/blst";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {Builder, BuilderOptions} from "../../src/builder.js";
import {BlockObserver} from "../../src/services/blockObserver.js";
import {BuilderSigner} from "../../src/services/builderSigner.js";
import {BuilderStatusTracker} from "../../src/services/builderStatusTracker.js";
import {PayloadStore} from "../../src/services/payloadStore.js";
import {ProposerPreferencesTracker} from "../../src/services/proposerPreferencesTracker.js";
import {getApiClientStub} from "./utils/apiStub.js";
import {ClockMock} from "./utils/clock.js";
import {getMockedLogger} from "./utils/logger.js";
import {mockBuiltPayload} from "./utils/payload.js";

describe("Builder", () => {
  it("starts background services with the shared signal and aborts them on close", async () => {
    const config = getConfig(ForkName.gloas);
    const logger = getMockedLogger();
    const api = getApiClientStub();
    const controller = new AbortController();
    const clock = new ClockMock();
    const secretKey = SecretKey.fromBytes(Buffer.alloc(32, 1));
    const keypair = {secretKey, publicKey: secretKey.toPublicKey()};
    const builderSigner = new BuilderSigner(createBeaconConfig(config, Buffer.alloc(32)), keypair);
    const builderStatusTracker = new BuilderStatusTracker(api, logger, 1, null);
    const blockObserver = new BlockObserver(config, logger, api);
    const proposerPreferencesTracker = new ProposerPreferencesTracker(api, logger);
    const preferences = ssz.gloas.SignedProposerPreferences.defaultValue();
    preferences.message.proposalSlot = 2;
    const dependentRoot = toRootHex(preferences.message.dependentRoot);
    proposerPreferencesTracker.onProposerPreferences(preferences);
    const store = new PayloadStore();
    const payload = mockBuiltPayload({slot: 0});
    const blockHash = toRootHex(payload.executionPayload.blockHash);
    store.add({slot: 0, parentBlockRoot: Buffer.alloc(32), blockHash, payload});
    const clockStart = vi.spyOn(clock, "start");
    const observerStart = vi.spyOn(blockObserver, "start").mockImplementation(() => {});
    const preferencesStart = vi.spyOn(proposerPreferencesTracker, "start").mockImplementation(() => {});

    const opts: BuilderOptions = {
      logger,
      config,
      keypair,
      abortController: controller,
      api,
      executionFeeRecipient: Buffer.alloc(20),
      metrics: null,
    };

    const builder = new Builder({
      opts,
      builderSigner,
      blockObserver,
      builderStatusTracker,
      proposerPreferencesTracker,
      clock,
      index: 1,
      store,
    });

    expect(clockStart).toHaveBeenCalledWith(controller.signal);
    expect(observerStart).toHaveBeenCalledWith(controller.signal);
    expect(preferencesStart).toHaveBeenCalledWith(controller.signal);
    expect(clockStart.mock.invocationCallOrder[0]).toBeLessThan(observerStart.mock.invocationCallOrder[0]);
    expect(clockStart.mock.invocationCallOrder[0]).toBeLessThan(preferencesStart.mock.invocationCallOrder[0]);
    expect(controller.signal.aborted).toBe(false);

    expect(store.has(blockHash)).toBe(true);
    expect(proposerPreferencesTracker.get(2, dependentRoot)).toBe(preferences);
    await clock.tickSlotFns(3, controller.signal);
    expect(store.has(blockHash)).toBe(false);
    expect(proposerPreferencesTracker.get(2, dependentRoot)).toBeNull();

    await builder.close();

    expect(controller.signal.aborted).toBe(true);
  });
});
