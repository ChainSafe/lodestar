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

  "bid.enabled"?: boolean;
  "execution.url"?: string;
  jwtSecret?: string;
  "bid.shareBps"?: number;
  "bid.fixedCostGwei"?: number;
  "bid.minValueGwei"?: number;
  "bid.maxValueGwei"?: number;
  "bid.minOperatingBalanceGwei"?: number;
  "bid.getPayloadAtBps"?: number;
  "bid.getPayloadTimeout"?: number;
  "bid.revealCutoffBps"?: number;

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

  "bid.enabled": {
    description:
      "Enable experimental Gloas bidding and prompt reveal. Requires an Engine URL, JWT secret and explicit bid timing.",
    type: "boolean",
    default: false,
    group: "bid",
  },
  "execution.url": {
    description:
      "Authenticated JSON-RPC URL of one building EL. Sharing the beacon node's EL is not production-qualified.",
    type: "string",
    group: "bid",
  },
  jwtSecret: {
    description: "Path to the building EL's JWT secret file",
    type: "string",
    group: "bid",
  },
  "bid.shareBps": {
    description: "Share of payload value offered to the proposer, in basis points. Required when bidding is enabled.",
    type: "number",
    group: "bid",
  },
  "bid.fixedCostGwei": {
    description: "Fixed amount deducted from the proportional bid, in Gwei",
    type: "number",
    group: "bid",
  },
  "bid.minValueGwei": {
    description: "Minimum bid value in Gwei",
    type: "number",
    group: "bid",
  },
  "bid.maxValueGwei": {
    description: "Maximum bid value in Gwei",
    type: "number",
    group: "bid",
  },
  "bid.minOperatingBalanceGwei": {
    description: "Builder balance reserved from bidding, in Gwei. Defaults to MIN_DEPOSIT_AMOUNT.",
    type: "number",
    group: "bid",
  },
  "bid.getPayloadAtBps": {
    description:
      "Retrieve the built payload at this fraction of the slot BEFORE proposal, in basis points. Required when bidding is enabled.",
    type: "number",
    group: "bid",
  },
  "bid.getPayloadTimeout": {
    description: "Payload retrieval timeout in milliseconds. Required when bidding is enabled.",
    type: "number",
    group: "bid",
  },
  "bid.revealCutoffBps": {
    description:
      "Stop reveal publication at this fraction of the selected block's slot, in basis points. Required when bidding is enabled.",
    type: "number",
    group: "bid",
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
