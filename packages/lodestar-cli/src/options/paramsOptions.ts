import {Options} from "yargs";
import {params} from "@chainsafe/lodestar-params/lib/presets/mainnet";

export interface IParamsOptions {
  chain: {
    params: Record<string, unknown>;
  };
}

export const paramsOptions = 
  Object.keys(params).reduce((options, key): Record<string, Options> => ({
    ...options,
    [`chain.params.${key}`]: {
      hidden: true,
      type: "string"
    }
  }), {} as Record<string, Options>);
