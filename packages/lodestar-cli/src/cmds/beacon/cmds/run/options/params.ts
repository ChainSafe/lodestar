import {params} from "@chainsafe/lodestar-params/lib/presets/mainnet";
import {IYargsOptionsMap} from "../../../../../util/yargs";

export const paramsOptions: IYargsOptionsMap = 
  Object.keys(params).reduce((options, key): IYargsOptionsMap => ({
    ...options,
    [`chain.params.${key}`]: {
      hidden: true,
      type: "string"
    }
  }), {} as IYargsOptionsMap);
