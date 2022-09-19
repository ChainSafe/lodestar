import {ICliCommandOptions, ILogArgs} from "../../util/index.js";
import {logOptions} from "../beacon/options.js";

export type IDiscv5Args = ILogArgs;
// & {
//   receiver: boolean;
// };

export const discv5Options: ICliCommandOptions<IDiscv5Args> = {
  ...logOptions,
};
