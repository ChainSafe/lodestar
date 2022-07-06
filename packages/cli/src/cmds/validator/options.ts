import {defaultOptions} from "@lodestar/validator";
import {ICliCommandOptions, ILogArgs} from "../../util/index.js";
import {logOptions, beaconPathsOptions} from "../beacon/options.js";
import {IBeaconPaths} from "../beacon/paths.js";
import {keymanagerRestApiServerOptsDefault} from "./keymanager/server.js";
import {defaultAccountPaths, defaultValidatorPaths} from "./paths.js";

export type AccountValidatorArgs = {
  keystoresDir?: string;
  secretsDir?: string;
  remoteKeysDir?: string;
};

export const validatorMetricsDefaultOptions = {
  enabled: false,
  port: 5064,
  address: "127.0.0.1",
};

export type IValidatorCliArgs = AccountValidatorArgs &
  KeymanagerArgs &
  ILogArgs & {
    logFile: IBeaconPaths["logFile"];
    validatorsDbDir?: string;
    server: string;
    force: boolean;
    graffiti: string;
    afterBlockDelaySlotFraction?: number;
    defaultFeeRecipient?: string;
    strictFeeRecipientCheck?: boolean;
    doppelgangerProtectionEnabled?: boolean;
    defaultGasLimit?: number;
    "builder.enabled"?: boolean;

    importKeystoresPath?: string[];
    importKeystoresPassword?: string;

    "externalSigner.url"?: string;
    "externalSigner.pubkeys"?: string[];
    "externalSigner.fetch"?: boolean;

    interopIndexes?: string;
    fromMnemonic?: string;
    mnemonicIndexes?: string;

    "metrics.enabled"?: boolean;
    "metrics.port"?: number;
    "metrics.address"?: string;
  };

export type KeymanagerArgs = {
  "keymanager.enabled"?: boolean;
  "keymanager.authEnabled"?: boolean;
  "keymanager.port"?: number;
  "keymanager.address"?: string;
  "keymanager.cors"?: string;
};

export const keymanagerOptions: ICliCommandOptions<KeymanagerArgs> = {
  "keymanager.enabled": {
    alias: ["keymanagerEnabled"], // Backwards compatibility
    type: "boolean",
    description: "Enable keymanager API server",
    default: false,
    group: "keymanager",
  },
  "keymanager.authEnabled": {
    alias: ["keymanagerAuthEnabled"], // Backwards compatibility
    type: "boolean",
    description: "Enable token bearer authentication for keymanager API server",
    default: true,
    group: "keymanager",
  },
  "keymanager.port": {
    alias: ["keymanagerPort"], // Backwards compatibility
    type: "number",
    description: "Set port for keymanager API",
    defaultDescription: String(keymanagerRestApiServerOptsDefault.port),
    group: "keymanager",
  },
  "keymanager.address": {
    alias: ["keymanagerHost"], // Backwards compatibility
    type: "string",
    description: "Set host for keymanager API",
    defaultDescription: keymanagerRestApiServerOptsDefault.address,
    group: "keymanager",
  },
  "keymanager.cors": {
    alias: ["keymanagerCors"], // Backwards compatibility
    type: "string",
    description: "Configures the Access-Control-Allow-Origin CORS header for keymanager API",
    defaultDescription: keymanagerRestApiServerOptsDefault.cors,
    group: "keymanager",
  },
};

export const validatorOptions: ICliCommandOptions<IValidatorCliArgs> = {
  ...logOptions,
  ...keymanagerOptions,
  logFile: beaconPathsOptions.logFile,

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

  validatorsDbDir: {
    hidden: true,
    description: "Data directory for validator databases.",
    defaultDescription: defaultValidatorPaths.validatorsDbDir,
    type: "string",
  },

  server: {
    description: "Address to connect to BeaconNode",
    default: "http://127.0.0.1:9596",
    type: "string",
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
    description: "Delay before publishing attestations if block comes early, as a fraction of SECONDS_PER_SLOT",
    type: "number",
  },

  defaultFeeRecipient: {
    description:
      "Specify fee recipient default for collecting the EL block fees and rewards (a hex string representing 20 bytes address: ^0x[a-fA-F0-9]{40}$). It would be possible (WIP) to override this per validator key using config or keymanager API. Only used post merge.",
    defaultDescription: defaultOptions.defaultFeeRecipient,
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

  "builder.enabled": {
    type: "boolean",
    description: "Enable execution payload production via a builder for better rewards",
    group: "builder",
  },

  importKeystoresPath: {
    alias: ["keystore", "directory"], // Backwards compatibility with old `validator import` cmd
    description: "Path(s) to a directory or single filepath to validator keystores, i.e. Launchpad validators",
    defaultDescription: "./keystores/*.json",
    type: "array",
  },

  importKeystoresPassword: {
    alias: ["passphraseFile"], // Backwards compatibility with old `validator import` cmd
    description: "Path to a file with password to decrypt all keystores from importKeystoresPath option",
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
    alias: ["externalSignerUrl"], // Backwards compatibility
    description: "URL to connect to an external signing server",
    type: "string",
    group: "externalSignerUrl",
  },

  "externalSigner.pubkeys": {
    alias: ["externalSignerPublicKeys"], // Backwards compatibility
    description:
      "List of validator public keys used by an external signer. May also provide a single string a comma separated public keys",
    type: "array",
    coerce: (pubkeys: string[]): string[] =>
      // Parse ["0x11,0x22"] to ["0x11", "0x22"]
      pubkeys.map((item) => item.split(",")).flat(1),
    group: "externalSignerUrl",
  },

  "externalSigner.fetch": {
    alias: ["externalSignerFetchPubkeys"], // Backwards compatibility
    conflicts: ["externalSigner.pubkeys"],
    description: "Fetch then list of pubkeys to validate from an external signer",
    type: "boolean",
    group: "externalSignerUrl",
  },

  // Metrics

  "metrics.enabled": {
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
