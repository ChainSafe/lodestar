import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {SecretKey} from "@chainsafe/lodestar-z/blst";
import {Builder, type BuilderBidOptions} from "@lodestar/builder";
import {chainConfig} from "@lodestar/config/default";
import {LogLevel} from "@lodestar/utils";
import {builderHandler} from "../../../../src/cmds/builder/handler.js";
import * as loadKeypair from "../../../../src/cmds/builder/loadKeypair.js";
import {IBuilderCliArgs} from "../../../../src/cmds/builder/options.js";
import * as runtime from "../../../../src/cmds/builder/runtime.js";
import {GlobalArgs} from "../../../../src/options/index.js";
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
        if (!previousListeners.get(signal)?.has(listener)) {
          process.removeListener(signal, listener as NodeJS.SignalsListener);
        }
      }
    }
    vi.restoreAllMocks();
  });

  async function runBuilderHandler(
    args: Partial<IBuilderCliArgs & GlobalArgs> & Record<string, unknown>
  ): Promise<void> {
    return builderHandler({
      logLevel: LogLevel.info,
      logFileLevel: LogLevel.debug,
      dataDir: testFilesDir,
      executionFeeRecipient: VALID_FEE_RECIPIENT,
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

  it.each([false, true])("passes the configured runtime to Builder.init, enabled=%s", async (enabled) => {
    const secretKey = SecretKey.fromBytes(Buffer.alloc(32, 1));
    vi.spyOn(loadKeypair, "loadBuilderKeypair").mockResolvedValue({secretKey, publicKey: secretKey.toPublicKey()});
    const bidRuntime: BuilderBidOptions | undefined = enabled
      ? {
          source: {id: "local", prepare: vi.fn(), getPayload: vi.fn()},
          policy: {computeValue: () => 1},
          orchestration: {getPayloadTimeout: 500},
          inputs: {deadlineBps: 9000, maxInputsPerSlot: 8},
          minOperatingBalanceGwei: 1,
          reveal: {cutoffBps: 5000},
        }
      : undefined;
    const getBidOptions = vi.spyOn(runtime, "getBuilderBidOptions").mockReturnValue(bidRuntime);
    const failure = Error("stop after runtime construction");
    const init = vi.spyOn(Builder, "init").mockRejectedValue(failure);

    await expect(
      runBuilderHandler({
        "params.GLOAS_FORK_EPOCH": String(chainConfig.FULU_FORK_EPOCH + 1),
        beaconNodeUrl: "http://localhost:9596",
        "bid.enabled": enabled,
      })
    ).rejects.toBe(failure);

    expect(init).toHaveBeenCalledOnce();
    const options = init.mock.calls[0][0];
    expect(options.bidRuntime).toBe(bidRuntime);
    expect(getBidOptions.mock.calls[0][2]).toBe(options.abortController.signal);
    expect(options.abortController.signal.aborted).toBe(true);
  });
});
