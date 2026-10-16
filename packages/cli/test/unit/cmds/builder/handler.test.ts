import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {SecretKey} from "@chainsafe/lodestar-z/blst";
import * as beaconNode from "@lodestar/beacon-node";
import {Builder, defaultOptions} from "@lodestar/builder";
import {chainConfig} from "@lodestar/config/default";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {LogLevel, toRootHex} from "@lodestar/utils";
import {builderHandler} from "../../../../src/cmds/builder/handler.js";
import * as loadKeypair from "../../../../src/cmds/builder/loadKeypair.js";
import {IBuilderCliArgs} from "../../../../src/cmds/builder/options.js";
import {GlobalArgs} from "../../../../src/options/index.js";
import {YargsError} from "../../../../src/util/errors.js";
import {testFilesDir} from "../../../utils.js";

describe("cmds / builder / args handler", () => {
  const ZERO_ADDRESS = "0x" + "0".repeat(40);
  const VALID_FEE_RECIPIENT = "0x" + "1".repeat(40);

  const signals = ["SIGINT", "SIGTERM"] as const;
  const previousListeners = new Map<NodeJS.Signals, Set<ReturnType<typeof process.rawListeners>[number]>>();
  beforeEach(() => {
    for (const signal of signals) previousListeners.set(signal, new Set(process.rawListeners(signal)));
  });
  afterEach(() => {
    for (const signal of signals) {
      for (const listener of process.rawListeners(signal)) {
        if (!previousListeners.get(signal)?.has(listener))
          process.removeListener(signal, listener as NodeJS.SignalsListener);
      }
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function runBuilderHandler(
    args: Partial<IBuilderCliArgs & GlobalArgs> & Record<string, unknown>
  ): Promise<void> {
    return builderHandler({
      logLevel: LogLevel.info,
      logFileLevel: LogLevel.debug,
      dataDir: testFilesDir,
      executionFeeRecipient: VALID_FEE_RECIPIENT,
      beaconNodeUrl: "http://127.0.0.1:9596",
      requestTimeout: 1000,
      "execution.urls": ["http://127.0.0.1:8551"],
      "execution.retries": 0,
      "execution.retryDelay": 100,
      ...Object.fromEntries(Object.entries(defaultOptions.bidding).map(([key, value]) => [`bidding.${key}`, value])),
      ...args,
    } as unknown as IBuilderCliArgs & GlobalArgs);
  }

  it("Should reject unscheduled Gloas", async () => {
    await expect(runBuilderHandler({})).rejects.toThrow("Gloas must be scheduled via GLOAS_FORK_EPOCH");
  });

  it("Should reject zero executionFeeRecipient", async () => {
    // Rejecting with the fee recipient error rather than the Gloas error also proves the
    // fork guard read the epoch merged in from CLI args, not from the default config
    await expect(
      runBuilderHandler({
        "params.GLOAS_FORK_EPOCH": String(chainConfig.FULU_FORK_EPOCH + 1),
        executionFeeRecipient: ZERO_ADDRESS,
      })
    ).rejects.toThrow("Cannot put zero address as an executionFeeRecipient");
  });

  it("does not repeat cleanup when a signal follows initialization failure", async () => {
    const secretKey = SecretKey.fromBytes(Buffer.alloc(32, 1));
    vi.spyOn(loadKeypair, "loadBuilderKeypair").mockResolvedValue({secretKey, publicKey: secretKey.toPublicKey()});
    const failure = Error("initialization failed");
    const init = vi.spyOn(Builder, "init").mockImplementation(async (options) => {
      vi.spyOn(options.abortController, "abort");
      throw failure;
    });
    await expect(runBuilderHandler({"params.GLOAS_FORK_EPOCH": String(chainConfig.FULU_FORK_EPOCH + 1)})).rejects.toBe(
      failure
    );
    const {abortController} = init.mock.calls[0][0];
    expect(abortController.signal.aborted).toBe(true);
    process.emit("SIGINT");
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(abortController.abort).toHaveBeenCalledOnce();
  });

  it.each([
    ["execution.urls", []],
    ["execution.urls", ["file:///tmp/engine"]],
    ["execution.urls", ["http://localhost:8551", "http://localhost:8552"]],
    ["execution.timeout", 0],
    ["execution.retryDelay", 2 ** 31],
    ["execution.retries", -1],
    ["bidding.deadlineBps", 10_000],
    ["reveal.cutoffBps", NaN],
    ["bidding.getPayloadTimeout", 0],
    ["bidding.getPayloadTimeout", 1_000_000],
    ["bidding.minOperatingBalanceGwei", -1],
    ["bidding.shareBps", 0.5],
    ["bidding.maxValueGwei", -1],
  ] as const)("rejects invalid %s before loading the keystore", async (option, value) => {
    const load = vi.spyOn(loadKeypair, "loadBuilderKeypair");
    const pending = runBuilderHandler({
      "params.GLOAS_FORK_EPOCH": String(chainConfig.FULU_FORK_EPOCH + 1),
      [option]: value,
    });
    await expect(pending).rejects.toBeInstanceOf(YargsError);
    await expect(pending).rejects.toThrow(String(option).replace("bidding.", ""));
    expect(load).not.toHaveBeenCalled();
  });

  it("does not expose invalid JWT contents", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "builder-handler-"));
    const jwtSecret = path.join(directory, "jwt.hex");
    try {
      fs.writeFileSync(jwtSecret, "secret-do-not-log");
      const pending = runBuilderHandler({
        "params.GLOAS_FORK_EPOCH": String(chainConfig.FULU_FORK_EPOCH + 1),
        jwtSecret,
      });
      await expect(pending).rejects.toThrow("Expected a 256-bit hex JWT secret");
      await expect(pending).rejects.not.toThrow("secret-do-not-log");
    } finally {
      fs.rmSync(directory, {recursive: true});
    }
  });

  it("connects the real Engine source and closes a Builder returned after shutdown", async () => {
    const secretKey = SecretKey.fromBytes(Buffer.alloc(32, 1));
    vi.spyOn(loadKeypair, "loadBuilderKeypair").mockResolvedValue({secretKey, publicKey: secretKey.toPublicKey()});
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (url, init) => {
      if (String(url).endsWith("/engine/v1/capabilities")) return new Response(null, {status: 404});
      const {method} = JSON.parse(String(init?.body));
      if (method === "engine_getClientVersionV1") {
        return Response.json({result: [{code: "GE", name: "Geth", version: "test", commit: "0x12345678"}]});
      }
      return Response.json({
        result: {payloadId: "0x0102030405060708", payloadStatus: {status: "VALID", latestValidHash: null}},
      });
    });
    vi.stubGlobal("fetch", fetch);
    const close = vi.fn(async () => {});
    vi.mocked(vi.spyOn(Builder, "init"), {partial: true}).mockImplementation(async (options) => {
      expect(options.bidding.deadlineBps).toBe(6000);
      const root = toRootHex(Buffer.alloc(32));
      const request = {
        fork: ForkName.gloas as const,
        forkchoiceState: {headBlockHash: root, safeBlockHash: root, finalizedBlockHash: root},
        payloadAttributes: ssz.gloas.PayloadAttributes.defaultValue(),
      };
      const handle = await options.payloadSource.prepare(request, new AbortController().signal);
      expect(handle.payloadId).toBe("0x0102030405060708");
      const calls = fetch.mock.calls
        .filter(([, init]) => init?.body !== undefined)
        .map(([, init]) => JSON.parse(String(init?.body)));
      expect(calls.find(({method}) => method === "engine_forkchoiceUpdatedV4").params[2]).toBeNull();
      process.emit("SIGINT");
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(options.abortController.signal.aborted).toBe(true);
      await expect(options.payloadSource.prepare(request, new AbortController().signal)).rejects.toThrow();
      return {close};
    });
    await runBuilderHandler({
      "params.GLOAS_FORK_EPOCH": String(chainConfig.FULU_FORK_EPOCH + 1),
      "bidding.deadlineBps": 6000,
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it("closes a metrics server returned after shutdown without starting the Builder", async () => {
    const secretKey = SecretKey.fromBytes(Buffer.alloc(32, 1));
    vi.spyOn(loadKeypair, "loadBuilderKeypair").mockResolvedValue({secretKey, publicKey: secretKey.toPublicKey()});
    const init = vi.spyOn(Builder, "init");
    const close = vi.fn(async () => {});
    vi.mocked(vi.spyOn(beaconNode, "getHttpMetricsServer"), {partial: true}).mockImplementation(async () => {
      process.emit("SIGINT");
      await new Promise<void>((resolve) => setImmediate(resolve));
      return {close};
    });
    await expect(
      runBuilderHandler({"params.GLOAS_FORK_EPOCH": String(chainConfig.FULU_FORK_EPOCH + 1), metrics: true})
    ).rejects.toMatchObject({name: "AbortError"});
    expect(close).toHaveBeenCalledOnce();
    expect(init).not.toHaveBeenCalled();
  });
});
