import {CliCommandOptions} from "@lodestar/utils";
import {coerceCors, enabledAllBashFriendly} from "../../options/beaconNodeOptions/api.js";
import {LogArgs, logOptions} from "../../options/logOptions.js";
import {validatorOptions} from "../validator/options.js";
import {defaultAccountPaths} from "../validator/paths.js";
import {defaultSignerPaths} from "./paths.js";
import {signerRestApiServerOptsDefault} from "./server.js";

export const signerMetricsDefaultOptions = {
  enabled: false,
  port: 5066,
  address: "127.0.0.1",
};

export type ISignerCliArgs = LogArgs & {
  keystoresDir?: string;
  secretsDir?: string;
  signerDbDir?: string;
  force?: boolean;

  importKeystores?: string[];
  importKeystoresPassword?: string;
  disableKeystoresThreadPool?: boolean;

  port?: number;
  address?: string;
  cors?: string;
  headerLimit?: number;
  bodyLimit?: number;
  stacktraces?: boolean;

  metrics?: boolean;
  "metrics.port"?: number;
  "metrics.address"?: string;

  interopIndexes?: number[];
  fromMnemonic?: string;
  mnemonicIndexes?: number[];
};

const {interopIndexes, fromMnemonic, mnemonicIndexes} = validatorOptions;

export const signerOptions: CliCommandOptions<ISignerCliArgs> = {
  ...logOptions,

  keystoresDir: {
    hidden: true,
    description: "Directory for storing validator keystores.",
    defaultDescription: defaultAccountPaths.keystoresDir,
    type: "string",
  },

  secretsDir: {
    hidden: true,
    description: "Directory for storing validator keystore secrets.",
    defaultDescription: defaultAccountPaths.secretsDir,
    type: "string",
  },

  signerDbDir: {
    hidden: true,
    description: "Data directory for the signer slashing protection database.",
    defaultDescription: defaultSignerPaths.signerDbDir,
    type: "string",
  },

  force: {
    description: "Open keystores even if there's a lockfile. Use with caution",
    type: "boolean",
  },

  importKeystores: {
    description: "Path(s) to a directory or single file path to validator keystores, i.e. Launchpad validators",
    defaultDescription: "./keystores/*.json",
    type: "array",
  },

  importKeystoresPassword: {
    description: "Path to a file with password to decrypt all keystores from `importKeystores` option",
    defaultDescription: "./password.txt",
    type: "string",
  },

  disableKeystoresThreadPool: {
    hidden: true,
    description:
      "Disable thread pool and instead use main thread to decrypt keystores. This can speed up decryption in testing environments like Kurtosis",
    type: "boolean",
  },

  port: {
    description: "Listen TCP port for the remote signing API",
    type: "number",
    defaultDescription: String(signerRestApiServerOptsDefault.port),
  },

  address: {
    description:
      "Listen address for the remote signing API. The API must not be exposed to the public internet, only validator clients should be able to reach it",
    type: "string",
    defaultDescription: String(signerRestApiServerOptsDefault.address),
  },

  cors: {
    description: `Configures the Access-Control-Allow-Origin CORS header for the remote signing API. Use '${enabledAllBashFriendly}' to allow all origins`,
    type: "string",
    defaultDescription: String(signerRestApiServerOptsDefault.cors),
    coerce: coerceCors,
  },

  headerLimit: {
    hidden: true,
    type: "number",
    description: "Defines the maximum length of request headers, in bytes, the server is allowed to accept",
  },

  bodyLimit: {
    hidden: true,
    type: "number",
    description: "Defines the maximum payload, in bytes, the server is allowed to accept",
  },

  stacktraces: {
    hidden: true,
    type: "boolean",
    description: "Return stacktraces in HTTP error responses",
  },

  // Metrics

  metrics: {
    type: "boolean",
    description: "Enable the Prometheus metrics HTTP server",
    defaultDescription: String(signerMetricsDefaultOptions.enabled),
    group: "metrics",
  },

  "metrics.port": {
    type: "number",
    description: "Listen TCP port for the Prometheus metrics HTTP server",
    defaultDescription: String(signerMetricsDefaultOptions.port),
    group: "metrics",
  },

  "metrics.address": {
    type: "string",
    description: "Listen address for the Prometheus metrics HTTP server",
    defaultDescription: String(signerMetricsDefaultOptions.address),
    group: "metrics",
  },

  // For testing only

  interopIndexes,
  fromMnemonic,
  mnemonicIndexes,
};
