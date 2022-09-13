import {ICliCommand} from "../../util/index.js";
import {IGlobalArgs} from "../../options/index.js";
import {gossipsubOptions, IGossipSubArgs} from "./options.js";
import {gossipsubHandler} from "./handler.js";

export const gossipsub: ICliCommand<IGossipSubArgs, IGlobalArgs> = {
  command: "gossipsub",
  describe: "Run gossipsub test",
  examples: [
    {
      command: "gossipsub --receiver true",
      description: "Run gossipsub with receiver mode",
    },
  ],
  options: gossipsubOptions,
  handler: gossipsubHandler,
};