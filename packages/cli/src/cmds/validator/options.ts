import {defaultOptions} from "@lodestar/validator";
import {LogArgs, logOptions} from "../../options/logOptions.js";
import {ensure0xPrefix, CliCommandOptions} from "../../util/index.js";
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
  interval: 60_000,
  initialDelay: 30_000,
  requestTimeout: 10_000,
  collectSystemStats: false,
};

// Defined as variable to not set yargs.default to an array
export const DEFAULT_BEACON_NODE_URL = "";

export type IValidatorCliArgs = AccountValidatorArgs &
  KeymanagerArgs &
  LogArgs & {
    validatorsDbDir?: string;
    beaconNodes: string[];
    force?: boolean;
    graffiti?: string;
    afterBlockDelaySlotFraction?: number;
    scAfterBlockDelaySlotFraction?: number;
    disableAttestationGrouping?: boolean;
    suggestedFeeRecipient?: string;
    proposerSettingsFile?: string;
    strictFeeRecipientCheck?: boolean;
    doppelgangerProtection?: boolean;
    defaultGasLimit?: number;

    builder?: boolean;
    "builder.selection"?: string;

    useProduceBlockV3?: boolean;

    importKeystores?: string[];
    importKeystoresPassword?: string;

    "externalSigner.url"?: string;
    "externalSigner.pubkeys"?: string[];
    "externalSigner.fetch"?: boolean;

    distributed?: boolean;

    interopIndexes?: string;
    fromMnemonic?: string;
    mnemonicIndexes?: string;

    metrics?: boolean;
    "metrics.port"?: number;
    "metrics.address"?: string;

    "monitoring.endpoint"?: string;
    "monitoring.interval"?: number;
    "monitoring.initialDelay"?: number;
    "monitoring.requestTimeout"?: number;
    "monitoring.collectSystemStats"?: boolean;
  };

export type KeymanagerArgs = {
  keymanager?: boolean;
  "keymanager.authEnabled"?: boolean;
  "keymanager.port"?: number;
  "keymanager.address"?: string;
  "keymanager.cors"?: string;
  "keymanager.headerLimit"?: number;
  "keymanager.bodyLimit"?: number;
};

export const keymanagerOptions: CliCommandOptions<KeymanagerArgs> = {
  keymanager: {
    type: "boolean",
    description: "Enable key manager API server",
    default: false,
    group: "keymanager",
  },
  "keymanager.authEnabled": {
    type: "boolean",
    description: "Enable token bearer authentication for key manager API server",
    default: true,
    group: "keymanager",
  },
  "keymanager.port": {
    type: "number",
    description: "Set port for key manager API",
    defaultDescription: String(keymanagerRestApiServerOptsDefault.port),
    group: "keymanager",
  },
  "keymanager.address": {
    type: "string",
    description: "Set host for key manager API",
    defaultDescription: keymanagerRestApiServerOptsDefault.address,
    group: "keymanager",
  },
  "keymanager.cors": {
    type: "string",
    description: "Configures the Access-Control-Allow-Origin CORS header for key manager API",
    defaultDescription: keymanagerRestApiServerOptsDefault.cors,
    group: "keymanager",
  },
  "keymanager.headerLimit": {
    hidden: true,
    type: "number",
    description: "Defines the maximum length of request headers, in bytes, the server is allowed to accept",
  },
  "keymanager.bodyLimit": {
    hidden: true,
    type: "number",
    description: "Defines the maximum payload, in bytes, the server is allowed to accept",
  },
};

export const validatorOptions: CliCommandOptions<IValidatorCliArgs> = {
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

  disableAttestationGrouping: {
    hidden: true,
    description:
      "Disables attestation service grouping optimization, attestation tasks will be executed per committee instead of just once for all committees.",
    type: "boolean",
  },

  proposerSettingsFile: {
    description:
      "A yaml file to specify detailed default and per validator public key customized proposer configs. PS: This feature and its format is in alpha and subject to change",
    type: "string",
  },

  suggestedFeeRecipient: {
    description:
      "Specify fee recipient default for collecting the EL block fees and rewards (a hex string representing 20 bytes address: ^0x[a-fA-F0-9]{40}$). It would be possible (WIP) to override this per validator key using config or key manager API. Only used post merge.",
    defaultDescription: defaultOptions.suggestedFeeRecipient,
    type: "string",
  },

  strictFeeRecipientCheck: {
    description: "Enable strict checking of the validator's `feeRecipient` with the one returned by engine",
    type: "boolean",
  },

  defaultGasLimit: {
    description: "Suggested gas limit to the engine/builder for building execution payloads. Only used post merge.",
    defaultDescription: `${defaultOptions.defaultGasLimit}`,
    type: "number",
  },

  builder: {
    type: "boolean",
    description: "Enable execution payload production via a builder for better rewards",
    group: "builder",
    deprecated: "enabling or disabling builder flow is now solely managed by `builder.selection` flag",
  },

  "builder.selection": {
    type: "string",
    description: "Default builder block selection strategy: `maxprofit`, `builderalways`, or `builderonly`",
    defaultDescription: `\`${defaultOptions.builderSelection}\``,
    group: "builder",
  },

  useProduceBlockV3: {
    type: "boolean",
    description: "Enable/disable usage of produceBlockV3 that might not be supported by all beacon clients yet",
    defaultDescription: `${defaultOptions.useProduceBlockV3}`,
  },

  importKeystores: {
    alias: ["keystore"], // Backwards compatibility with old `validator import` cmdx
    description: "Path(s) to a directory or single file path to validator keystores, i.e. Launchpad validators",
    defaultDescription: "./keystores/*.json",
    type: "array",
  },

  importKeystoresPassword: {
    alias: ["passphraseFile"], // Backwards compatibility with old `validator import` cmd
    description: "Path to a file with password to decrypt all keystores from `importKeystores` option",
    defaultDescription: "`./password.txt`",
    type: "string",
  },

  doppelgangerProtection: {
    alias: ["doppelgangerProtectionEnabled"],
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
    description: "Fetch then list of public keys to validate from an external signer",
    type: "boolean",
    group: "externalSignerUrl",
  },

  // Distributed validator

  distributed: {
    description: "Enables specific features required to run as part of a distributed validator cluster",
    type: "boolean",
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
      "Enables monitoring service for sending clients stats to the specified endpoint of a remote service (e.g. beaconcha.in)",
    group: "monitoring",
  },

  "monitoring.interval": {
    type: "number",
    description: "Interval in milliseconds between sending client stats to the remote service",
    defaultDescription: String(validatorMonitoringDefaultOptions.interval),
    group: "monitoring",
  },

  "monitoring.initialDelay": {
    type: "number",
    description: "Initial delay in milliseconds before client stats are sent to the remote service",
    defaultDescription: String(validatorMonitoringDefaultOptions.initialDelay),
    group: "monitoring",
    hidden: true,
  },

  "monitoring.requestTimeout": {
    type: "number",
    description: "Timeout in milliseconds for sending client stats to the remote service",
    defaultDescription: String(validatorMonitoringDefaultOptions.requestTimeout),
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
