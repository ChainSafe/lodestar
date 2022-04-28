import fs from "node:fs";
import {defaultOptions, IBeaconNodeOptions} from "@chainsafe/lodestar";
import {ICliCommandOptions, extractJwtHexSecret, parseFeeRecipientHex} from "../../util";

export type ExecutionEngineArgs = {
  "execution.urls": string[];
  "execution.timeout": number;
  defaultSuggestedFeeRecipient?: string;
  "jwt-secret"?: string;
};

export function parseArgs(args: ExecutionEngineArgs): IBeaconNodeOptions["executionEngine"] {
  return {
    urls: args["execution.urls"],
    timeout: args["execution.timeout"],
    /**
     * jwtSecret is parsed as hex instead of bytes because the merge with defaults
     * in beaconOptions messes up the bytes array as as index => value object
     */
    jwtSecretHex: args["jwt-secret"]
      ? extractJwtHexSecret(fs.readFileSync(args["jwt-secret"], "utf-8").trim())
      : undefined,
    /**
     * defaultSuggestedFeeRecipient is parsed as hex instead of ExecutionAddress
     * bytes because the merge with defaults in beaconOptions messes up the bytes
     * array as index => value object
     */
    defaultSuggestedFeeRecipientHex: args["defaultSuggestedFeeRecipient"]
      ? parseFeeRecipientHex(args["defaultSuggestedFeeRecipient"])
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

  defaultSuggestedFeeRecipient: {
    description:
      "Specify fee recipient default for collecting the EL block fees and rewards (a hex string representing 20 bytes address: ^0x[a-fA-F0-9]{40}$) in case validator fails to update for a validator index before calling produceBlock.",
    default:
      defaultOptions.executionEngine.mode === "http"
        ? String(defaultOptions.executionEngine.defaultSuggestedFeeRecipientHex)
        : "",
    type: "string",
    group: "execution",
  },
};
