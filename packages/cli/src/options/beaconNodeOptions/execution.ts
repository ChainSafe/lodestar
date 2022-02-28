import fs from "node:fs";
import {defaultOptions, IBeaconNodeOptions} from "@chainsafe/lodestar";
import {ICliCommandOptions, extractJwtHexSecret} from "../../util";

export type ExecutionEngineArgs = {
  "execution.urls": string[];
  "execution.timeout": number;
  "jwt-secret"?: string;
};

export function parseArgs(args: ExecutionEngineArgs): IBeaconNodeOptions["executionEngine"] {
  return {
    urls: args["execution.urls"],
    timeout: args["execution.timeout"],
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

  "jwt-secret": {
    description:
      "File path to a shared hex-encoded jwt secret which will be used to generate and bundle HS256 encoded jwt tokens for authentication with the EL client's rpc server hosting engine apis. Secret to be exactly same as the one used by the corresponding EL client.",
    type: "string",
    group: "execution",
  },
};
