import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import yargs from "yargs";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName, MIN_DEPOSIT_AMOUNT} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {LogLevel, toHex} from "@lodestar/utils";
import {type IBuilderCliArgs, builderOptions} from "../../../../src/cmds/builder/options.js";
import {getBuilderBidOptions} from "../../../../src/cmds/builder/runtime.js";
import {rcConfigOption} from "../../../../src/options/globalOptions.js";
import {YargsError} from "../../../../src/util/errors.js";

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
      bid: true,
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
    args.bid = false;
    args.jwtSecret = "missing";
    expect(getBuilderBidOptions(args, config, controller.signal)).toBeUndefined();
  });

  it.each(["execution.url", "jwtSecret"] as const)("requires %s before constructing the runtime", (option) => {
    delete args[option];
    expect(() => getBuilderBidOptions(args, config, controller.signal)).toThrow();
  });

  it("enables bidding through the normal rc-config loader", () => {
    const configPath = path.join(directory, "builder.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        bid: {enabled: true, shareBps: 8500},
        keystore: args.keystore,
        keystorePassword: args.keystorePassword,
        executionFeeRecipient: args.executionFeeRecipient,
        execution: {url: args["execution.url"]},
        jwtSecret: args.jwtSecret,
      })
    );
    const parsed = yargs(["--rcConfig", configPath])
      .exitProcess(false)
      .strict()
      .parserConfiguration({"dot-notation": false})
      .options(builderOptions)
      .config(...rcConfigOption)
      .parseSync();
    expect(parsed.bid).toBe(true);
    expect(parsed["bid.shareBps"]).toBe(8500);
    const runtime = getBuilderBidOptions(
      {...args, bid: parsed.bid, "bid.shareBps": parsed["bid.shareBps"]},
      config,
      controller.signal
    );
    expect(runtime?.policy.computeValue({payloadValueGwei: 100, coverableGwei: 100})).toBe(85);
  });

  it("uses useful defaults and the configured payload-attestation cutoff", () => {
    delete args["bid.shareBps"];
    delete args["bid.getPayloadAtBps"];
    delete args["bid.getPayloadTimeout"];
    delete args["bid.revealCutoffBps"];
    const runtime = getBuilderBidOptions(args, config, controller.signal);
    expect(runtime?.inputs.deadlineBps).toBe(9500);
    expect(runtime?.orchestration.getPayloadTimeout).toBe(1000);
    expect(runtime?.reveal.cutoffBps).toBe(config.PAYLOAD_ATTESTATION_DUE_BPS);
    expect(runtime?.policy.computeValue({payloadValueGwei: 100, coverableGwei: 100})).toBe(90);
  });

  it("does not impose the current producer's event timing on explicit configuration", () => {
    expect(
      getBuilderBidOptions({...args, "bid.getPayloadAtBps": 6000}, config, controller.signal)?.inputs.deadlineBps
    ).toBe(6000);
  });

  it.each([
    ["bid.getPayloadTimeout", 0],
    ["bid.shareBps", 0.5],
    ["bid.minOperatingBalanceGwei", -1],
  ] as const)("reports an option-specific CLI error for %s", (option, value) => {
    const create = () => getBuilderBidOptions({...args, [option]: value}, config, controller.signal);
    expect(create).toThrow(YargsError);
    expect(create).toThrow(option.startsWith("bid.") ? option.slice(4) : option);
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
