import {Options} from "yargs";
import {params} from "@chainsafe/lodestar-params/lib/presets/mainnet";

const options: Record<string, Options> = {};

Object.keys(params).forEach((key) => {
  options[key] = {
    alias: [
      `chain.params.${key}`,
    ],
    hidden: true,
  };
});

export const paramsOptions = options;
