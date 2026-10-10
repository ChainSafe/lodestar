import fs from "node:fs";
import {type BuilderBidOptions, EnginePayloadSource, ProportionalBidPolicy} from "@lodestar/builder";
import type {ChainForkConfig} from "@lodestar/config";
import type {Logger} from "@lodestar/logger";
import {MIN_DEPOSIT_AMOUNT} from "@lodestar/params";
import {fromHex, isValidHttpUrl} from "@lodestar/utils";
import {YargsError} from "../../util/errors.js";
import {extractJwtHexSecret} from "../../util/jwt.js";
import {createPayloadSourceEngine} from "./engine.js";
import {type IBuilderCliArgs, builderBidDefaultOptions} from "./options.js";

export function getBuilderBidOptions(
  args: IBuilderCliArgs,
  config: ChainForkConfig,
  signal: AbortSignal,
  logger: Logger
): BuilderBidOptions | undefined {
  if (!args.bid) return undefined;
  signal.throwIfAborted();
  const url = args["execution.url"];
  if (!url || !args.jwtSecret) {
    throw new YargsError("Bidding requires execution.url and jwtSecret");
  }
  if (!isValidHttpUrl(url)) throw new YargsError("execution.url must be an HTTP or HTTPS URL");
  const deadlineBps = args["bid.getPayloadAtBps"] ?? builderBidDefaultOptions.getPayloadAtBps;
  const cutoffBps = args["bid.revealCutoffBps"] ?? config.PAYLOAD_ATTESTATION_DUE_BPS;
  for (const [option, value] of [
    ["bid.getPayloadAtBps", deadlineBps],
    ["bid.revealCutoffBps", cutoffBps],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0 || value >= 10_000) {
      throw new YargsError(`Invalid ${option}, expected an integer within (0, 10000)`);
    }
  }
  const getPayloadTimeout = args["bid.getPayloadTimeout"] ?? builderBidDefaultOptions.getPayloadTimeout;
  if (
    !Number.isSafeInteger(getPayloadTimeout) ||
    getPayloadTimeout <= 0 ||
    getPayloadTimeout > config.SLOT_DURATION_MS
  ) {
    throw new YargsError(`bid.getPayloadTimeout must be a positive integer no greater than ${config.SLOT_DURATION_MS}`);
  }
  const shareBps = args["bid.shareBps"] ?? builderBidDefaultOptions.shareBps;
  const minOperatingBalanceGwei = args["bid.minOperatingBalanceGwei"] ?? MIN_DEPOSIT_AMOUNT;
  if (!Number.isSafeInteger(minOperatingBalanceGwei) || minOperatingBalanceGwei < MIN_DEPOSIT_AMOUNT) {
    throw new YargsError(`bid.minOperatingBalanceGwei must be a safe integer of at least ${MIN_DEPOSIT_AMOUNT}`);
  }
  let policy: ProportionalBidPolicy;
  try {
    policy = new ProportionalBidPolicy({
      shareBps,
      fixedCostGwei: args["bid.fixedCostGwei"] ?? 0,
      minValueGwei: args["bid.minValueGwei"] ?? 0,
      maxValueGwei: args["bid.maxValueGwei"],
    });
  } catch (error) {
    throw new YargsError(`Invalid bid policy options: ${(error as Error).message}`);
  }
  let jwtSecret: Uint8Array;
  try {
    const secretFile = fs.readFileSync(args.jwtSecret, "utf8").trim();
    jwtSecret = fromHex(extractJwtHexSecret(secretFile));
  } catch {
    throw new YargsError("Unable to read jwtSecret. Expected a 256-bit hex JWT secret");
  }
  return {
    source: new EnginePayloadSource("local", createPayloadSourceEngine({url, jwtSecret, signal, logger})),
    policy,
    orchestration: {getPayloadTimeout},
    inputs: {deadlineBps, maxInputsPerSlot: 8},
    minOperatingBalanceGwei,
    reveal: {cutoffBps},
  };
}
