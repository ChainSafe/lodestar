import {ACTIVE_PRESET} from "@lodestar/params";
import {CliCommandOptions} from "@lodestar/utils";
import {NetworkName, networkNames} from "../networks/index.js";
import {flattenObject, readFile, translateEnabledKeys} from "../util/index.js";
import {IParamsArgs, paramsOptions} from "./paramsOptions.js";

type GlobalSingleArgs = {
  dataDir?: string;
  network?: NetworkName;
  paramsFile?: string;
  preset: string;
  presetFile?: string;
  rcConfig?: string;
  supernode?: boolean;
  semiSupernode?: boolean;
  "zig-bls"?: boolean;
};

export const defaultNetwork: NetworkName = "mainnet";

const globalSingleOptions: CliCommandOptions<GlobalSingleArgs> = {
  dataDir: {
    description: "Lodestar root data directory",
    type: "string",
  },

  network: {
    description: "Name of the Ethereum Consensus chain network to join",
    type: "string",
    defaultDescription: defaultNetwork,
    choices: networkNames,
  },

  paramsFile: {
    description: "Network configuration file",
    type: "string",
  },

  // hidden option to allow for LODESTAR_PRESET to be set
  preset: {
    hidden: true,
    type: "string",
    default: ACTIVE_PRESET,
  },

  presetFile: {
    hidden: true,
    description: "Preset configuration file to override the active preset with custom values",
    type: "string",
  },

  rcConfig: {
    description: "RC file to supplement command line args, accepted formats: .yml, .yaml, .json",
    type: "string",
    example: {
      description: `Options can be written as nested maps or dotted keys

\`\`\`yaml
network: hoodi
logLevel: debug
metrics:
  enabled: true
  port: 8008
\`\`\``,
    },
  },

  supernode: {
    description: "Subscribe to and custody all data column sidecar subnets",
    type: "boolean",
    conflicts: ["semiSupernode"],
  },

  semiSupernode: {
    description:
      "Subscribe to and custody half of the data column sidecar subnets to support blob reconstruction, enabling more efficient data availability with lower bandwidth and storage requirements compared to a supernode.",
    type: "boolean",
    conflicts: ["supernode"],
  },

  "zig-bls": {
    hidden: true,
    type: "boolean",
  },
};

export const rcConfigOption: [string, string, (configPath: string) => Record<string, unknown>] = [
  "rcConfig",
  globalSingleOptions.rcConfig.description as string,
  (configPath: string): Record<string, unknown> =>
    translateEnabledKeys(flattenObject(readFile(configPath, ["json", "yml", "yaml"]))),
];

export type GlobalArgs = GlobalSingleArgs & IParamsArgs;

export const globalOptions = {
  ...globalSingleOptions,
  ...paramsOptions,
};
