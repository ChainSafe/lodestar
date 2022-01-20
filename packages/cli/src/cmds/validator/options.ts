import {ICliCommandOptions, ILogArgs} from "../../util";
import {defaultValidatorPaths} from "./paths";
import {accountValidatorOptions, IAccountValidatorArgs} from "../account/cmds/validator/options";
import {logOptions, beaconPathsOptions} from "../beacon/options";
import {IBeaconPaths} from "../beacon/paths";

export type IValidatorCliArgs = IAccountValidatorArgs &
  ILogArgs & {
    logFile: IBeaconPaths["logFile"];
    validatorsDbDir?: string;
    server: string;
    force: boolean;
    graffiti: string;
    importKeystoresPath?: string[];
    importKeystoresPassword?: string;
    externalSignerUrl?: string;
    externalSignerPublicKeys?: string[];
    externalSignerFetchPubkeys?: boolean;
    interopIndexes?: string;
    fromMnemonic?: string;
    mnemonicIndexes?: string;
  };

export const validatorOptions: ICliCommandOptions<IValidatorCliArgs> = {
  ...accountValidatorOptions,
  ...logOptions,
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
