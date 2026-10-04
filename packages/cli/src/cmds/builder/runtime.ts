import fs from "node:fs";
import {type BuilderBidOptions, EnginePayloadSource, ProportionalBidPolicy} from "@lodestar/builder";
import type {ChainForkConfig} from "@lodestar/config";
import {MIN_DEPOSIT_AMOUNT} from "@lodestar/params";
import {LodestarError, fromHex} from "@lodestar/utils";
import {extractJwtHexSecret} from "../../util/jwt.js";
import {createPayloadSourceEngine} from "./engine.js";
import type {IBuilderCliArgs} from "./options.js";

export function getBuilderBidOptions(
  args: IBuilderCliArgs,
  config: ChainForkConfig,
  signal: AbortSignal
): BuilderBidOptions | undefined {
  if (!args["bid.enabled"]) return undefined;
  signal.throwIfAborted();
  const url = args["execution.url"];
  if (!url || !args.jwtSecret) {
    throw new LodestarError({code: "BUILDER_ENGINE_CONFIG_REQUIRED"}, "Bidding requires execution.url and jwtSecret");
  }
  const deadlineBps = args["bid.getPayloadAtBps"];
  const cutoffBps = args["bid.revealCutoffBps"];
  if (deadlineBps === undefined || cutoffBps === undefined) {
    throw new LodestarError(
      {code: "BUILDER_BID_TIMING_REQUIRED"},
      "Bidding requires bid.getPayloadAtBps and bid.revealCutoffBps"
    );
  }
  for (const [option, value] of [
    ["bid.getPayloadAtBps", deadlineBps],
    ["bid.revealCutoffBps", cutoffBps],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0 || value >= 10_000) {
      throw new LodestarError(
        {code: "BUILDER_INVALID_BID_OPTION", option},
        `Invalid ${option}, expected an integer within (0, 10000)`
      );
    }
  }
  const getPayloadTimeout = args["bid.getPayloadTimeout"];
  if (
    getPayloadTimeout === undefined ||
    !Number.isSafeInteger(getPayloadTimeout) ||
    getPayloadTimeout <= 0 ||
    getPayloadTimeout > config.SLOT_DURATION_MS
  ) {
    throw new LodestarError({code: "BUILDER_INVALID_BID_OPTION", option: "bid.getPayloadTimeout"});
  }
  const shareBps = args["bid.shareBps"];
  if (shareBps === undefined) {
    throw new LodestarError({code: "BUILDER_INVALID_BID_OPTION", option: "bid.shareBps"});
  }
  const minOperatingBalanceGwei = args["bid.minOperatingBalanceGwei"] ?? MIN_DEPOSIT_AMOUNT;
  if (!Number.isSafeInteger(minOperatingBalanceGwei) || minOperatingBalanceGwei < MIN_DEPOSIT_AMOUNT) {
    throw new LodestarError({code: "BUILDER_INVALID_BID_OPTION", option: "bid.minOperatingBalanceGwei"});
  }
  const policy = new ProportionalBidPolicy({
    shareBps,
    fixedCostGwei: args["bid.fixedCostGwei"] ?? 0,
    minValueGwei: args["bid.minValueGwei"] ?? 0,
    maxValueGwei: args["bid.maxValueGwei"],
  });
  const secretFile = fs.readFileSync(args.jwtSecret, "utf8").trim();
  let jwtSecret: Uint8Array;
  try {
    jwtSecret = fromHex(extractJwtHexSecret(secretFile));
  } catch {
    throw new LodestarError({code: "BUILDER_INVALID_JWT_SECRET"}, "Expected a 256-bit hex JWT secret");
  }
  return {
    source: new EnginePayloadSource("local", createPayloadSourceEngine({url, jwtSecret, signal})),
    policy,
    orchestration: {getPayloadTimeout},
    inputs: {deadlineBps, maxInputsPerSlot: 8},
    minOperatingBalanceGwei,
    reveal: {cutoffBps},
  };
}
