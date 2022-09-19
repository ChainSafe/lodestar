import {ICliCommand} from "../../util/index.js";
import {IGlobalArgs} from "../../options/index.js";
import {discv5Options, IDiscv5Args} from "./options.js";
import {discv5Handler} from "./handler.js";

export const discv5: ICliCommand<IDiscv5Args, IGlobalArgs> = {
  command: "discv5",
  describe: "Run discv5 test",
  examples: [
    {
      command: "discv5",
      description: "Run discv5",
    },
  ],
  options: discv5Options,
  handler: discv5Handler,
};