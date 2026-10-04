import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName, MIN_DEPOSIT_AMOUNT} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {LogLevel, toHex} from "@lodestar/utils";
import type {IBuilderCliArgs} from "../../../../src/cmds/builder/options.js";
import {getBuilderBidOptions} from "../../../../src/cmds/builder/runtime.js";

describe("Builder bid runtime configuration", () => {
  const config = getConfig(ForkName.gloas);
  let directory: string;
  let args: IBuilderCliArgs;
  let controller: AbortController;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "builder-rpc-config-"));
    const jwtSecret = path.join(directory, "jwt.hex");
    fs.writeFileSync(jwtSecret, "11".repeat(32));
    args = {
      logLevel: LogLevel.info,
      logFileLevel: LogLevel.debug,
      logFileDailyRotate: 5,
      beaconNodeUrl: "http://localhost:9596",
      keystore: "unused.json",
      keystorePassword: "unused.txt",
      executionFeeRecipient: "0x" + "22".repeat(20),
      requestTimeout: 1000,
      "bid.enabled": true,
      "execution.url": "http://localhost:8551",
      jwtSecret,
      "bid.shareBps": 8000,
      "bid.getPayloadAtBps": 9000,
      "bid.getPayloadTimeout": 500,
      "bid.revealCutoffBps": 5000,
    };
    controller = new AbortController();
  });

  afterEach(() => {
    controller.abort();
    vi.unstubAllGlobals();
    fs.rmSync(directory, {recursive: true});
  });

  it("leaves observation-only startup unchanged when bidding is disabled", () => {
    args["bid.enabled"] = false;
    args.jwtSecret = "missing";
    expect(getBuilderBidOptions(args, config, controller.signal)).toBeUndefined();
  });

  it.each([
    "execution.url",
    "jwtSecret",
    "bid.shareBps",
    "bid.getPayloadAtBps",
    "bid.getPayloadTimeout",
    "bid.revealCutoffBps",
  ] as const)("requires %s before constructing the runtime", (option) => {
    delete args[option];
    expect(() => getBuilderBidOptions(args, config, controller.signal)).toThrow();
  });

  it.each([0, -1, NaN, Infinity, 1.5, 10000])("rejects invalid slot timing %s", (value) => {
    for (const option of ["bid.getPayloadAtBps", "bid.revealCutoffBps"] as const) {
      expect(() => getBuilderBidOptions({...args, [option]: value}, config, controller.signal), option).toThrow();
    }
  });

  it.each([0, -1, NaN, Infinity, 1.5, config.SLOT_DURATION_MS + 1])("rejects invalid retrieval timeout %s", (value) => {
    expect(() => getBuilderBidOptions({...args, "bid.getPayloadTimeout": value}, config, controller.signal)).toThrow();
  });

  it("keeps validation of policy options in ProportionalBidPolicy", () => {
    expect(() => getBuilderBidOptions({...args, "bid.shareBps": 0.5}, config, controller.signal)).toThrow("shareBps");
    expect(() => getBuilderBidOptions({...args, "bid.maxValueGwei": -1}, config, controller.signal)).toThrow(
      "maxValueGwei"
    );
  });

  it("rejects a reserve below the minimum deposit", () => {
    expect(() =>
      getBuilderBidOptions({...args, "bid.minOperatingBalanceGwei": MIN_DEPOSIT_AMOUNT - 1}, config, controller.signal)
    ).toThrow();
  });

  it("does not include malformed JWT contents in the error", () => {
    fs.writeFileSync(args.jwtSecret as string, "secret-do-not-log");
    expect(() => getBuilderBidOptions(args, config, controller.signal)).toThrow("Expected a 256-bit hex JWT secret");
    expect(() => getBuilderBidOptions(args, config, controller.signal)).not.toThrow("secret-do-not-log");
  });

  it("constructs the real Gloas source with null custody and shared shutdown", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      Response.json({
        result: {
          payloadId: "0x0102030405060708",
          payloadStatus: {status: "VALID", latestValidHash: null, validationError: null},
        },
      })
    );
    vi.stubGlobal("fetch", fetch);
    const runtime = getBuilderBidOptions(args, config, controller.signal);
    expect(runtime).toBeDefined();
    if (!runtime) throw Error("Runtime not constructed");
    expect(runtime.reveal).toEqual({cutoffBps: 5000});
    expect(runtime.policy.computeValue({payloadValueGwei: 100, coverableGwei: 100})).toBe(80);
    expect(runtime.minOperatingBalanceGwei).toBe(MIN_DEPOSIT_AMOUNT);
    const root = toHex(new Uint8Array(32));
    const request = {
      fork: ForkName.gloas as const,
      forkchoiceState: {headBlockHash: root, safeBlockHash: root, finalizedBlockHash: root},
      payloadAttributes: ssz.gloas.PayloadAttributes.defaultValue(),
    };
    await runtime.source.prepare(request, new AbortController().signal);
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({
      method: "engine_forkchoiceUpdatedV4",
      params: [request.forkchoiceState, expect.any(Object), null],
    });
    controller.abort();
    await expect(runtime.source.prepare(request, new AbortController().signal)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledOnce();
  });
});
