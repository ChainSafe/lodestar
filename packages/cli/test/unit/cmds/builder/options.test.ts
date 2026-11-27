import net from "node:net";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {initializeExecutionEngine} from "@lodestar/beacon-node";
import {defaultOptions} from "@lodestar/builder";
import {ForkName} from "@lodestar/params";
import {LogLevel} from "@lodestar/utils";
import {builderOptions} from "../../../../src/cmds/builder/options.js";
import {testLogger} from "../../../utils.js";

describe("cmds / builder / options", () => {
  let controller: AbortController;

  beforeEach(() => {
    controller = new AbortController();
  });

  afterEach(() => {
    controller.abort();
  });

  /** Url nothing listens on */
  async function getOfflineUrl(): Promise<string> {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const {port} = server.address() as net.AddressInfo;
    await new Promise((resolve) => server.close(resolve));
    return `http://127.0.0.1:${port}`;
  }

  it("Should report an execution client that can not be reached before a payload build times out", async () => {
    const logger = testLogger();
    const logError = vi.spyOn(logger, LogLevel.error);
    const engine = initializeExecutionEngine(
      {
        mode: "http",
        urls: [await getOfflineUrl()],
        retries: builderOptions["execution.retries"].default,
        retryDelay: builderOptions["execution.retryDelay"].default,
      },
      {signal: controller.signal, logger}
    );
    const hash = `0x${"11".repeat(32)}`;
    // Only a request to build a payload is retried
    const payloadAttributes = {
      timestamp: 1,
      prevRandao: Buffer.alloc(32),
      suggestedFeeRecipient: `0x${"00".repeat(20)}`,
      withdrawals: [],
      parentBeaconBlockRoot: Buffer.alloc(32),
    };
    // The shortest time a build is given, the builder aborts the request after it
    const request = new AbortController();
    const timeout = setTimeout(() => request.abort(), defaultOptions.bidding.getPayloadTimeout);

    // Not aborted while it waits to be retried, which would hide the error
    await expect(
      engine.notifyForkchoiceUpdate(ForkName.gloas, hash, hash, hash, payloadAttributes, request.signal)
    ).rejects.toThrow("ECONNREFUSED");
    clearTimeout(timeout);

    expect(request.signal.aborted).toBe(false);
    expect(logError).toHaveBeenCalledExactlyOnceWith(
      "Execution client went offline",
      expect.anything(),
      expect.objectContaining({message: expect.stringContaining("ECONNREFUSED")})
    );
  });
});
