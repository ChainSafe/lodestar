import {defaultExecutionEngineHttpOpts} from "@lodestar/beacon-node";
import {defaultOptions} from "@lodestar/builder";
import {CliCommandOptions} from "@lodestar/utils";
import {LogArgs, logOptions} from "../../options/logOptions.js";

export const builderMetricsDefaultOptions = {
  enabled: false,
  port: 5065,
  address: "127.0.0.1",
};

export type IBuilderCliArgs = LogArgs & {
  beaconNodeUrl: string;
  keystore: string;
  keystorePassword: string;
  builderPubkey?: string;
  executionFeeRecipient: string;
  requestTimeout: number;

  "execution.urls": string[];
  "execution.timeout"?: number;
  "execution.retries": number;
  "execution.retryDelay": number;
  jwtSecret?: string;
  jwtId?: string;

  "bidding.shareBps": number;
  "bidding.fixedCostGwei": number;
  "bidding.minValueGwei": number;
  "bidding.maxValueGwei"?: number;
  "bidding.deadlineBps": number;
  "bidding.prepareRetryMs": number;
  "bidding.getPayloadTimeoutMs": number;
  "bidding.minOperatingBalanceGwei": number;
  "reveal.cutoffBps"?: number;

  metrics?: boolean;
  "metrics.port"?: number;
  "metrics.address"?: string;
};

export const builderOptions: CliCommandOptions<IBuilderCliArgs> = {
  ...logOptions,

  beaconNodeUrl: {
    description: "Url to a trusted beacon node",
    type: "string",
    default: defaultOptions.beaconNodeUrl,
  },

  keystore: {
    description: "Path to a keystore file",
    type: "string",
    demandOption: true,
  },

  keystorePassword: {
    description: "Path to a file with password to decrypt the keystore from 'keystore' option",
    type: "string",
    demandOption: true,
  },

  builderPubkey: {
    description: "Builder's expected public key based on the keystore from 'keystore' option",
    type: "string",
  },

  executionFeeRecipient: {
    description: "Execution address for receiving the payload rewards",
    type: "string",
    demandOption: true,
  },

  requestTimeout: {
    description: "Timeout in milliseconds for HTTP requests to the beacon node",
    type: "number",
    default: defaultOptions.requestTimeout,
  },

  // Execution

  "execution.urls": {
    description:
      "Urls to execution client engine APIs. Each execution client builds payloads independently and the most valuable payload is bid on. Execution clients must be kept in sync by a beacon node",
    default: defaultExecutionEngineHttpOpts.urls.join(","),
    type: "array",
    string: true,
    coerce: (urls: string[]): string[] =>
      // Parse ["url1,url2"] to ["url1", "url2"]
      urls.flatMap((item) => item.split(",")),
    group: "execution",
  },

  "execution.timeout": {
    description: "Timeout in milliseconds for execution engine API HTTP client",
    type: "number",
    defaultDescription: String(defaultExecutionEngineHttpOpts.timeout),
    group: "execution",
  },

  "execution.retries": {
    description: "Number of retries when calling execution engine API",
    type: "number",
    default: defaultExecutionEngineHttpOpts.retries,
    group: "execution",
  },

  "execution.retryDelay": {
    description: "Delay time in milliseconds between retries when retrying calls to the execution engine API",
    type: "number",
    default: defaultExecutionEngineHttpOpts.retryDelay,
    group: "execution",
  },

  jwtSecret: {
    description:
      "File path to a shared hex-encoded jwt secret which will be used to generate and bundle HS256 encoded jwt tokens for authentication with the EL client's rpc server hosting engine apis. Secret to be exactly same as the one used by the corresponding EL client.",
    type: "string",
    group: "execution",
  },

  jwtId: {
    description:
      "An optional identifier to be set in the id field of the claims included in jwt tokens used for authentication with EL client's rpc server hosting engine apis",
    type: "string",
    group: "execution",
  },

  // Bidding

  "bidding.shareBps": {
    description: "Share of the payload value offered to the proposer, in basis points",
    type: "number",
    default: defaultOptions.bidding.shareBps,
    group: "bidding",
  },

  "bidding.fixedCostGwei": {
    description: "Fixed amount in gwei deducted from the proposer share of every bid",
    type: "number",
    default: defaultOptions.bidding.fixedCostGwei,
    group: "bidding",
  },

  "bidding.minValueGwei": {
    description: "Never bid below this value in gwei",
    type: "number",
    default: defaultOptions.bidding.minValueGwei,
    group: "bidding",
  },

  "bidding.maxValueGwei": {
    description: "Never bid above this value in gwei",
    type: "number",
    group: "bidding",
  },

  "bidding.deadlineBps": {
    description:
      "Point within the slot before the target slot at which payloads are fetched and bids are published, in basis points",
    type: "number",
    default: defaultOptions.bidding.deadlineBps,
    group: "bidding",
  },

  "bidding.prepareRetryMs": {
    description:
      "Interval in milliseconds between attempts to start a payload build while the execution client is syncing",
    type: "number",
    default: defaultOptions.bidding.prepareRetryMs,
    group: "bidding",
  },

  "bidding.getPayloadTimeoutMs": {
    description: "Time budget in milliseconds for fetching payloads from execution clients at the bid deadline",
    type: "number",
    default: defaultOptions.bidding.getPayloadTimeoutMs,
    group: "bidding",
  },

  "bidding.minOperatingBalanceGwei": {
    description: "Do not bid while the builder balance is below this value in gwei",
    type: "number",
    default: defaultOptions.bidding.minOperatingBalanceGwei,
    group: "bidding",
  },

  "reveal.cutoffBps": {
    description:
      "Do not reveal the payload if the block committing to our bid arrives after this point within its slot, in basis points. Defaults to PAYLOAD_ATTESTATION_DUE_BPS of the network",
    type: "number",
    group: "reveal",
  },

  // Metrics

  metrics: {
    description: "Enable the Prometheus metrics HTTP server",
    type: "boolean",
    defaultDescription: String(builderMetricsDefaultOptions.enabled),
    group: "metrics",
  },

  "metrics.port": {
    description: "Listen TCP port for the Prometheus metrics HTTP server",
    type: "number",
    defaultDescription: String(builderMetricsDefaultOptions.port),
    group: "metrics",
  },

  "metrics.address": {
    description: "Listen address for the Prometheus metrics HTTP server",
    type: "string",
    defaultDescription: String(builderMetricsDefaultOptions.address),
    group: "metrics",
  },
};
