import {ICliCommand, ICliCommandOptions} from "../../util";
import {IGlobalArgs} from "../../options";
import {devOptions, IDevArgs} from "./options";
import {devHandler} from "./handler";

export const dev: ICliCommand<IDevArgs, IGlobalArgs> = {
  command: "dev",
  describe: "Command used to quickly bootstrap beacon node and validators",
  options: devOptions as ICliCommandOptions<IDevArgs>,
  handler: devHandler
};
