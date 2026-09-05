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
