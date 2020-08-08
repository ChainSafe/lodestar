import {ICliCommand, ICliCommandOptions} from "../../util";
import {IGlobalArgs} from "../../options";
import {devOptions, IDevOptions} from "./options";
import {devHandler} from "./handler";

export const dev: ICliCommand<IDevOptions, IGlobalArgs> = {
  command: "dev",
  describe: "Command used to quickly bootstrap beacon node and validators",
  options: devOptions as ICliCommandOptions<IDevOptions>,
  handler: devHandler
};
