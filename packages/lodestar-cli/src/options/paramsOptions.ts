import {Options} from "yargs";
import {params} from "@chainsafe/lodestar-params/lib/presets/mainnet";

export interface IParamsOptions {
  params: Record<string, unknown>;
}

export const paramsOptions = 
  Object.keys(params).reduce((options, key): Record<string, Options> => ({
    ...options,
    [`params.${key}`]: {
      hidden: true,
      type: "string"
    }
  }), {} as Record<string, Options>);
