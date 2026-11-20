import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {afterEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {SecretKey} from "@lodestar/native/blst";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {defer, toRootHex} from "@lodestar/utils";
import {Builder, BuilderOptions} from "../../src/builder.js";
import {BlockObserver} from "../../src/services/blockObserver.js";
import {BuilderSigner} from "../../src/services/builderSigner.js";
import {BuilderStatusTracker} from "../../src/services/builderStatusTracker.js";
import {PayloadStore} from "../../src/services/payloadStore.js";
import {ProposerPreferencesCache} from "../../src/services/proposerPreferencesCache.js";
import {ProposerPreferencesRecovery} from "../../src/services/proposerPreferencesRecovery.js";
import {ProposerPreferencesTracker} from "../../src/services/proposerPreferencesTracker.js";
import {getApiClientStub, mockApiResponse} from "./utils/apiStub.js";
import {biddingOptions, createBiddingModules, getPayloadSourceStub} from "./utils/bidding.js";
import {ClockMock} from "./utils/clock.js";
import {getMockedLogger} from "./utils/logger.js";

describe("Builder preference tracking", () => {
  const directories: string[] = [];
  afterEach(async () => {
    for (const directory of directories.splice(0)) await fs.rm(directory, {recursive: true, force: true});
  });
  it("subscribes, retains preferences, prunes on slot ticks and aborts on close", async () => {
    const config = getConfig(ForkName.gloas);
    const logger = getMockedLogger();
    const api = getApiClientStub();
    api.events.eventstream.mockResolvedValue(mockApiResponse({data: undefined, meta: undefined}));
    const controller = new AbortController();
    const clock = new ClockMock();
    const secretKey = SecretKey.fromBytes(Buffer.alloc(32, 1));
    const keypair = {secretKey, publicKey: secretKey.toPublicKey()};
    const builderSigner = new BuilderSigner(createBeaconConfig(config, Buffer.alloc(32)), keypair);
    const builderStatusTracker = new BuilderStatusTracker(api, logger, 1, null);
    const blockObserver = new BlockObserver(config, logger, api);
    const proposerPreferencesTracker = new ProposerPreferencesTracker();
    const payloadStore = new PayloadStore();
    const payloadSource = getPayloadSourceStub();
    const opts: BuilderOptions = {
      logger,
      config,
      keypair,
      abortController: controller,
      api,
      executionFeeRecipient: Buffer.alloc(20),
      metrics: null,
      payloadSource,
      bidding: biddingOptions,
      reveal: {},
    };
    const clockStart = vi.spyOn(clock, "start");
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "builder-preference-integration-"));
    directories.push(directory);
    const filename = path.join(directory, "preferences.json");
    const identity = {genesisValidatorsRoot: toRootHex(Buffer.alloc(32)), pubkey: builderSigner.getPubkeyHex()};
    const preferencesCache = new ProposerPreferencesCache(filename, identity, logger);
    const builder = new Builder({
      preferencesCache,
      opts,
      builderSigner,
      blockObserver,
      builderStatusTracker,
      proposerPreferencesTracker,
      proposerPreferencesRecovery: new ProposerPreferencesRecovery(
        {config, logger, tracker: proposerPreferencesTracker, metrics: null, signal: controller.signal},
        {
          primary: {id: "primary", api},
          additional: [],
          genesisValidatorsRoot: toRootHex(Buffer.alloc(32)),
          genesisTime: 0,
          timeoutMs: 1000,
        }
      ),
      clock,
      index: 1,
      payloadStore,
      builderApi: null,
      ...createBiddingModules({
        api,
        config,
        logger,
        clock,
        builderSigner,
        proposerPreferencesTracker,
        payloadStore,
        payloadSource,
        signal: controller.signal,
      }),
    });

    expect(clockStart).toHaveBeenCalledWith(controller.signal);
    expect(api.events.eventstream).toHaveBeenCalledOnce();
    const [{onEvent, signal, topics}] = api.events.eventstream.mock.calls[0];
    expect(topics).toEqual([
      routes.events.EventType.block,
      routes.events.EventType.proposerPreferences,
      routes.events.EventType.payloadAttributes,
    ]);
    expect(signal).toBe(controller.signal);
    const signed = ssz.gloas.SignedProposerPreferences.defaultValue();
    signed.message.proposalSlot = 4;
    const root = toRootHex(signed.message.dependentRoot);
    onEvent({type: routes.events.EventType.proposerPreferences, message: {version: ForkName.gloas, data: signed}});
    expect(builder.proposerPreferencesTracker.get(4, root)).toEqual(signed);

    const stalledCacheWrite = defer<void>();
    vi.spyOn(preferencesCache, "save").mockReturnValueOnce(stalledCacheWrite.promise);
    await clock.tickSlotFns(4, controller.signal);
    stalledCacheWrite.resolve();
    expect(builder.proposerPreferencesTracker.get(4, root)).toEqual(signed);
    await preferencesCache.save(builder.proposerPreferencesTracker, 4);
    expect(
      await new ProposerPreferencesCache(filename, identity, logger).load(new ProposerPreferencesTracker(), 4)
    ).toBe(1);
    await clock.tickSlotFns(5, controller.signal);
    expect(builder.proposerPreferencesTracker.get(4, root)).toBeNull();

    const future = ssz.gloas.SignedProposerPreferences.clone(signed);
    future.message.proposalSlot = 6;
    onEvent({type: routes.events.EventType.proposerPreferences, message: {version: ForkName.gloas, data: future}});
    await builder.close();
    const restored = new ProposerPreferencesTracker();
    expect(await new ProposerPreferencesCache(filename, identity, logger).load(restored, 6)).toBe(1);
    expect(restored.get(6, root)).toEqual(future);
    expect(signal.aborted).toBe(true);
    onEvent({type: routes.events.EventType.proposerPreferences, message: {version: ForkName.gloas, data: signed}});
    expect(builder.proposerPreferencesTracker.get(4, root)).toBeNull();
  });
});
