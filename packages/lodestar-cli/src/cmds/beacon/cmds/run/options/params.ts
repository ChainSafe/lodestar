import {Options} from "yargs";
import {params} from "@chainsafe/lodestar-params/lib/presets/mainnet";

const options: Record<string, Options> = {};

Object.keys(params).forEach((key) => {
  options[key] = {
    alias: [
      `chain.params.${key}`,
    ],
    hidden: true,
    type: yargsOptionType(params[key as keyof typeof params])
  };
});


function yargsOptionType(value: unknown): Options["type"] {
  if (typeof value === "string" || Buffer.isBuffer(value)) return "string";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (Array.isArray(value)) return "array";
  else return undefined;
}

export const paramsOptions = options;
