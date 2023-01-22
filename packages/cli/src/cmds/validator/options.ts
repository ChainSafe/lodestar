import {defaultOptions} from "@lodestar/validator";
import {logOptions} from "../../options/logOptions.js";
import {ensure0xPrefix, ICliCommandOptions, ILogArgs} from "../../util/index.js";
import {keymanagerRestApiServerOptsDefault} from "./keymanager/server.js";
import {defaultAccountPaths, defaultValidatorPaths} from "./paths.js";

export type AccountValidatorArgs = {
  keystoresDir?: string;
  secretsDir?: string;
  remoteKeysDir?: string;
  proposerDir?: string;
};

export const validatorMetricsDefaultOptions = {
  enabled: false,
  port: 5064,
  address: "127.0.0.1",
};

export const validatorMonitoringDefaultOptions = {
  interval: 60,
  collectSystemStats: false,
};

// Defined as variable to not set yargs.default to an array
export const DEFAULT_BEACON_NODE_URL = "";

export type IValidatorCliArgs = AccountValidatorArgs &
  KeymanagerArgs &
  ILogArgs & {
    validatorsDbDir?: string;
    beaconNodes: string[];
    force: boolean;
    graffiti: string;
    afterBlockDelaySlotFraction?: number;
    scAfterBlockDelaySlotFraction?: number;
    suggestedFeeRecipient?: string;
    proposerSettingsFile?: string;
    strictFeeRecipientCheck?: boolean;
    doppelgangerProtectionEnabled?: boolean;
    defaultGasLimit?: number;
    builder?: boolean;

    importKeystores?: string[];
    importKeystoresPassword?: string;

    "externalSigner.url"?: string;
    "externalSigner.pubkeys"?: string[];
    "externalSigner.fetch"?: boolean;

    interopIndexes?: string;
    fromMnemonic?: string;
    mnemonicIndexes?: string;

    metrics?: boolean;
    "metrics.port"?: number;
    "metrics.address"?: string;

    "monitoring.endpoint": string;
    "monitoring.interval": number;
    "monitoring.collectSystemStats": boolean;
  };

export type KeymanagerArgs = {
  keymanager?: boolean;
  "keymanager.authEnabled"?: boolean;
  "keymanager.port"?: number;
  "keymanager.address"?: string;
  "keymanager.cors"?: string;
  "keymanager.bodyLimit"?: number;
};

export const keymanagerOptions: ICliCommandOptions<KeymanagerArgs> = {
  keymanager: {
    type: "boolean",
    description: "Enable keymanager API server",
    default: false,
    group: "keymanager",
  },
  "keymanager.authEnabled": {
    type: "boolean",
    description: "Enable token bearer authentication for keymanager API server",
    default: true,
    group: "keymanager",
  },
  "keymanager.port": {
    type: "number",
    description: "Set port for keymanager API",
    defaultDescription: String(keymanagerRestApiServerOptsDefault.port),
    group: "keymanager",
  },
  "keymanager.address": {
    type: "string",
    description: "Set host for keymanager API",
    defaultDescription: keymanagerRestApiServerOptsDefault.address,
    group: "keymanager",
  },
  "keymanager.cors": {
    type: "string",
    description: "Configures the Access-Control-Allow-Origin CORS header for keymanager API",
    defaultDescription: keymanagerRestApiServerOptsDefault.cors,
    group: "keymanager",
  },
  "keymanager.bodyLimit": {
    hidden: true,
    type: "number",
    description: "Defines the maximum payload, in bytes, the server is allowed to accept",
  },
};

export const validatorOptions: ICliCommandOptions<IValidatorCliArgs> = {
  ...logOptions,
  ...keymanagerOptions,

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

  remoteKeysDir: {
    hidden: true,
    description: "Directory for storing validator remote key definitions.",
    defaultDescription: defaultAccountPaths.keystoresDir,
    type: "string",
  },

  proposerDir: {
    hidden: true,
    description: "Directory for storing keymanager's proposer configs for validators",
    defaultDescription: defaultAccountPaths.proposerDir,
    type: "string",
  },

  validatorsDbDir: {
    hidden: true,
    description: "Data directory for validator databases.",
    defaultDescription: defaultValidatorPaths.validatorsDbDir,
    type: "string",
  },

  beaconNodes: {
    description: "Addresses to connect to BeaconNode",
    default: ["http://127.0.0.1:9596"],
    type: "array",
    string: true,
    coerce: (urls: string[]): string[] =>
      // Parse ["url1,url2"] to ["url1", "url2"]
      urls.map((item) => item.split(",")).flat(1),
    alias: ["server"], // for backwards compatibility
  },

  force: {
    description: "Open validators even if there's a lockfile. Use with caution",
    type: "boolean",
  },

  graffiti: {
    description: "Specify your custom graffiti to be included in blocks (plain UTF8 text, 32 characters max)",
    // Don't use a default here since it should be computed only if necessary by getDefaultGraffiti()
    type: "string",
  },

  afterBlockDelaySlotFraction: {
    hidden: true,
    description:
      "Delay before publishing attestations if block comes early, as a fraction of SECONDS_PER_SLOT (value is from 0 inclusive to 1 exclusive)",
    type: "number",
  },

  scAfterBlockDelaySlotFraction: {
    hidden: true,
    description:
      "Delay before publishing SyncCommitteeSignature if block comes early, as a fraction of SECONDS_PER_SLOT (value is from 0 inclusive to 1 exclusive)",
    type: "number",
  },

  proposerSettingsFile: {
    description:
      "A yaml file to specify detailed default and per validator pubkey customized proposer configs. PS: This feature and its format is in alpha and subject to change",
    type: "string",
  },

  suggestedFeeRecipient: {
    description:
      "Specify fee recipient default for collecting the EL block fees and rewards (a hex string representing 20 bytes address: ^0x[a-fA-F0-9]{40}$). It would be possible (WIP) to override this per validator key using config or keymanager API. Only used post merge.",
    defaultDescription: defaultOptions.suggestedFeeRecipient,
    type: "string",
  },

  strictFeeRecipientCheck: {
    description: "Enable strict checking of the validator's feeRecipient with the one returned by engine",
    type: "boolean",
  },

  defaultGasLimit: {
    description: "Suggested gasLimit to the engine/builder for building execution payloads. Only used post merge.",
    defaultDescription: `${defaultOptions.defaultGasLimit}`,
    type: "number",
  },

  builder: {
    type: "boolean",
    description: "Enable execution payload production via a builder for better rewards",
    group: "builder",
  },

  importKeystores: {
    alias: ["keystore"], // Backwards compatibility with old `validator import` cmdx
    description: "Path(s) to a directory or single filepath to validator keystores, i.e. Launchpad validators",
    defaultDescription: "./keystores/*.json",
    type: "array",
  },

  importKeystoresPassword: {
    alias: ["passphraseFile"], // Backwards compatibility with old `validator import` cmd
    description: "Path to a file with password to decrypt all keystores from importKeystores option",
    defaultDescription: "./password.txt",
    type: "string",
  },

  doppelgangerProtectionEnabled: {
    description: "Enables Doppelganger protection",
    default: false,
    type: "boolean",
  },

  // HIDDEN INTEROP OPTIONS

  // Remote signer

  "externalSigner.url": {
    description: "URL to connect to an external signing server",
    type: "string",
    group: "externalSignerUrl",
  },

  "externalSigner.pubkeys": {
    description:
      "List of validator public keys used by an external signer. May also provide a single string a comma separated public keys",
    type: "array",
    string: true, // Ensures the pubkey string is not automatically converted to numbers
    coerce: (pubkeys: string[]): string[] =>
      // Parse ["0x11,0x22"] to ["0x11", "0x22"]
      pubkeys
        .map((item) => item.split(","))
        .flat(1)
        .map(ensure0xPrefix),
    group: "externalSignerUrl",
  },

  "externalSigner.fetch": {
    conflicts: ["externalSigner.pubkeys"],
    description: "Fetch then list of pubkeys to validate from an external signer",
    type: "boolean",
    group: "externalSignerUrl",
  },

  // Metrics

  metrics: {
    type: "boolean",
    description: "Enable the Prometheus metrics HTTP server",
    defaultDescription: String(validatorMetricsDefaultOptions.enabled),
    group: "metrics",
  },

  "metrics.port": {
    type: "number",
    description: "Listen TCP port for the Prometheus metrics HTTP server",
    defaultDescription: String(validatorMetricsDefaultOptions.port),
    group: "metrics",
  },

  "metrics.address": {
    type: "string",
    description: "Listen address for the Prometheus metrics HTTP server",
    defaultDescription: String(validatorMetricsDefaultOptions.address),
    group: "metrics",
  },

  // Monitoring

  "monitoring.endpoint": {
    type: "string",
    description:
      "Enables monitoring service for sending clients stats to the specified endpoint of a remote server (e.g. beaconcha.in). It is required that metrics are enabled by supplying the --metrics flag.",
    group: "monitoring",
  },

  "monitoring.interval": {
    type: "number",
    description: "Interval in seconds between sending client stats to the remote server",
    defaultDescription: String(validatorMonitoringDefaultOptions.interval),
    group: "monitoring",
    hidden: true,
  },

  "monitoring.collectSystemStats": {
    type: "boolean",
    description:
      "Enable collecting system stats. This should only be enabled if validator client and beacon node are running on different hosts.",
    defaultDescription: String(validatorMonitoringDefaultOptions.collectSystemStats),
    group: "monitoring",
    hidden: true,
  },

  // For testing only

  interopIndexes: {
    hidden: true,
    description: "Range (inclusive) of interop key indexes to validate with: 0..16",
    type: "string",
  },

  fromMnemonic: {
    hidden: true,
    description: "UNSAFE. Run keys from a mnemonic. Requires mnemonicIndexes option",
    type: "string",
  },

  mnemonicIndexes: {
    hidden: true,
    description: "UNSAFE. Range (inclusive) of mnemonic key indexes to validate with: 0..16",
    type: "string",
  },
};
