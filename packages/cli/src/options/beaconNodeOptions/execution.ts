import fs from "node:fs";
import {defaultOptions, IBeaconNodeOptions} from "@lodestar/beacon-node";
import {ICliCommandOptions, extractJwtHexSecret} from "../../util/index.js";

export type ExecutionEngineArgs = {
  "execution.urls": string[];
  "execution.timeout": number;
  "execution.retryAttempts": number;
  "execution.retryDelay": number;
  "execution.engineMock"?: boolean;
  "jwt-secret"?: string;
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
    retryAttempts: args["execution.retryAttempts"],
    retryDelay: args["execution.retryDelay"],
    /**
     * jwtSecret is parsed as hex instead of bytes because the merge with defaults
     * in beaconOptions messes up the bytes array as as index => value object
     */
    jwtSecretHex: args["jwt-secret"]
      ? extractJwtHexSecret(fs.readFileSync(args["jwt-secret"], "utf-8").trim())
      : undefined,
  };
}

export const options: ICliCommandOptions<ExecutionEngineArgs> = {
  "execution.urls": {
    description: "Urls to execution client engine API",
    type: "array",
    defaultDescription:
      defaultOptions.executionEngine.mode === "http" ? defaultOptions.executionEngine.urls.join(" ") : "",
    group: "execution",
  },

  "execution.timeout": {
    description: "Timeout in miliseconds for execution engine API HTTP client",
    type: "number",
    defaultDescription:
      defaultOptions.executionEngine.mode === "http" ? String(defaultOptions.executionEngine.timeout) : "",
    group: "execution",
  },

  "execution.retryAttempts": {
    description: "Number of retry attempts when calling execution engine API",
    type: "number",
    defaultDescription:
      defaultOptions.executionEngine.mode === "http" ? String(defaultOptions.executionEngine.retryAttempts) : "1",
    group: "execution",
  },

  "execution.retryDelay": {
    description: "Delay time in milliseconds between retries when retrying calls to the execution engine API",
    type: "number",
    defaultDescription:
      defaultOptions.executionEngine.mode === "http" ? String(defaultOptions.executionEngine.retryDelay) : "0",
    group: "execution",
  },

  "execution.engineMock": {
    description: "Set the execution engine to mock mode",
    type: "boolean",
    hidden: true,
    group: "execution",
  },

  "jwt-secret": {
    description:
      "File path to a shared hex-encoded jwt secret which will be used to generate and bundle HS256 encoded jwt tokens for authentication with the EL client's rpc server hosting engine apis. Secret to be exactly same as the one used by the corresponding EL client.",
    type: "string",
    group: "execution",
  },
};
