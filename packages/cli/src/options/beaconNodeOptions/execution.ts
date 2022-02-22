import fs from "node:fs";
import {defaultOptions, IBeaconNodeOptions} from "@chainsafe/lodestar";
import {ICliCommandOptions, extractJwtHexSecret} from "../../util";

export type ExecutionEngineArgs = {
  "execution.urls": string[];
  "execution.timeout": number;
  "jwt-secret"?: string;
};

export function parseArgs(args: ExecutionEngineArgs): IBeaconNodeOptions["executionEngine"] {
  let jwtSecretHex;
  if (args["jwt-secret"]) {
    jwtSecretHex = extractJwtHexSecret(fs.readFileSync(args["jwt-secret"], "utf-8").trim());
  }
  return {
    urls: args["execution.urls"],
    timeout: args["execution.timeout"],
    jwtSecretHex,
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

  "jwt-secret": {
    description: "Shared jwt secret which EL will use to authenticate engine api calls",
    type: "string",
    group: "execution",
  },
};
