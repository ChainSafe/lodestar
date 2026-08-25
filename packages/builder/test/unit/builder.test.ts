import {describe, expect, it, vi} from "vitest";
import {SecretKey} from "@chainsafe/lodestar-z/blst";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName} from "@lodestar/params";
import {Builder, BuilderOptions} from "../../src/builder.js";
import {BlockObserver} from "../../src/services/blockObserver.js";
import {BuilderSigner} from "../../src/services/builderSigner.js";
import {BuilderStatusTracker} from "../../src/services/builderStatusTracker.js";
import {getApiClientStub} from "./utils/apiStub.js";
import {ClockMock} from "./utils/clock.js";
import {getMockedLogger} from "./utils/logger.js";

describe("Builder", () => {
  it("starts long-lived duties with the shared signal and aborts them on close", async () => {
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
    const clockStart = vi.spyOn(clock, "start");
    const observerStart = vi.spyOn(blockObserver, "start").mockImplementation(() => {});

    const opts: BuilderOptions = {
      logger,
      config,
      keypair,
      abortController: controller,
      api,
      executionFeeRecipient: Buffer.alloc(20),
      metrics: null,
    };

    const builder = new Builder({opts, builderSigner, blockObserver, builderStatusTracker, clock, index: 1});

    expect(clockStart).toHaveBeenCalledWith(controller.signal);
    expect(observerStart).toHaveBeenCalledWith(controller.signal);
    expect(clockStart.mock.invocationCallOrder[0]).toBeLessThan(observerStart.mock.invocationCallOrder[0]);
    expect(controller.signal.aborted).toBe(false);

    await builder.close();

    expect(controller.signal.aborted).toBe(true);
  });
});
