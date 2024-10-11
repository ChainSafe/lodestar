import fs from "node:fs";
import {defaultExecutionEngineHttpOpts, IBeaconNodeOptions} from "@lodestar/beacon-node";
import {CliCommandOptions} from "@lodestar/utils";
import {extractJwtHexSecret} from "../../util/index.js";

export type ExecutionEngineArgs = {
  "execution.urls": string[];
  "execution.timeout"?: number;
  "execution.retries": number;
  "execution.retryDelay": number;
  "execution.engineMock"?: boolean;
  jwtSecret?: string;
  jwtId?: string;
};

export function parseArgs(args: ExecutionEngineArgs): IBeaconNodeOptions["executionEngine"] {
  if (args["execution.engineMock"]) {
    return {
      mode: "mock",
      genesisBlockHash: "",
    };
  }

  return {
    urls: args["execution.urls"],
    timeout: args["execution.timeout"],
    retries: args["execution.retries"],
    retryDelay: args["execution.retryDelay"],
    /**
     * jwtSecret is parsed as hex instead of bytes because the merge with defaults
     * in beaconOptions messes up the bytes array as as index => value object
     */
    jwtSecretHex: args["jwtSecret"]
      ? extractJwtHexSecret(fs.readFileSync(args["jwtSecret"], "utf-8").trim())
      : undefined,
    jwtId: args["jwtId"],
  };
}

export const options: CliCommandOptions<ExecutionEngineArgs> = {
  "execution.urls": {
    description: "Urls to execution client engine API",
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
    alias: ["execution.retryAttempts"],
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

  "execution.engineMock": {
    description: "Set the execution engine to mock mode (development only)",
    type: "boolean",
    hidden: false,
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
};
