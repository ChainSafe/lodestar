import {CliCommand} from "@lodestar/utils";
import {GlobalArgs} from "../../options/index.js";
import {builderHandler} from "./handler.js";
import {IBuilderCliArgs, builderOptions} from "./options.js";

export const builder: CliCommand<IBuilderCliArgs, GlobalArgs> = {
  command: "builder",
  describe: "Run one or multiple builder clients",
  docsFolder: "run/builder-management",
  examples: [
    {
      command: "builder",
      title: "Base `builder` command",
      description: "Run builder client",
    },
  ],
  options: builderOptions,
  handler: builderHandler,
  subcommands: [],
};
