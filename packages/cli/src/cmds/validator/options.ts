import {defaultOptions} from "@chainsafe/lodestar";
import {ICliCommandOptions, ILogArgs} from "../../util/index.js";
import {defaultValidatorPaths} from "./paths.js";
import {accountValidatorOptions, IAccountValidatorArgs} from "../account/cmds/validator/options.js";
import {logOptions, beaconPathsOptions} from "../beacon/options.js";
import {IBeaconPaths} from "../beacon/paths.js";
import {KeymanagerArgs, keymanagerOptions} from "../../options/keymanagerOptions.js";

export const validatorMetricsDefaultOptions = {
  enabled: false,
  port: 5064,
  address: "127.0.0.1",
};

export const defaultDefaultFeeRecipient = defaultOptions.chain.defaultFeeRecipient;

export type IValidatorCliArgs = IAccountValidatorArgs &
  ILogArgs & {
    logFile: IBeaconPaths["logFile"];
    validatorsDbDir?: string;
    server: string;
    force: boolean;
    graffiti: string;
    afterBlockDelaySlotFraction?: number;
    defaultFeeRecipient?: string;
    strictFeeRecipientCheck?: boolean;

    importKeystoresPath?: string[];
    importKeystoresPassword?: string;
    externalSignerUrl?: string;
    externalSignerPublicKeys?: string[];
    externalSignerFetchPubkeys?: boolean;
    interopIndexes?: string;
    fromMnemonic?: string;
    mnemonicIndexes?: string;

    "metrics.enabled"?: boolean;
    "metrics.port"?: number;
    "metrics.address"?: string;
  } & KeymanagerArgs;

export const validatorOptions: ICliCommandOptions<IValidatorCliArgs> = {
  ...accountValidatorOptions,
  ...logOptions,
  ...keymanagerOptions,
  logFile: beaconPathsOptions.logFile,

  validatorsDbDir: {
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
      "Specify fee recipient default for collecting the EL block fees and rewards (a hex string representing 20 bytes address: ^0x[a-fA-F0-9]{40}$). It would be possible (WIP) to override this per validator key using config or keymanager API.",
    defaultDescription: defaultDefaultFeeRecipient,
    type: "string",
  },

  strictFeeRecipientCheck: {
    description: "Enable strict checking of the validator's feeRecipient with the one returned by engine",
    type: "boolean",
  },

  importKeystoresPath: {
    description: "Path(s) to a directory or single filepath to validator keystores, i.e. Launchpad validators",
    defaultDescription: "./keystores/*.json",
    type: "array",
  },

  importKeystoresPassword: {
    description: "Path to a file with password to decrypt all keystores from importKeystoresPath option",
    defaultDescription: "./password.txt",
    type: "string",
  },

  // HIDDEN INTEROP OPTIONS

  // Remote signer

  externalSignerUrl: {
    description: "URL to connect to an external signing server",
    type: "string",
    group: "External signer",
  },

  externalSignerPublicKeys: {
    description:
      "List of validator public keys used by an external signer. May also provide a single string a comma separated public keys",
    type: "array",
    coerce: (pubkeys: string[]): string[] =>
      // Parse ["0x11,0x22"] to ["0x11", "0x22"]
      pubkeys.map((item) => item.split(",")).flat(1),
    group: "External signer",
  },

  externalSignerFetchPubkeys: {
    description: "Fetch then list of pubkeys to validate from an external signer",
    type: "boolean",
    group: "External signer",
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
