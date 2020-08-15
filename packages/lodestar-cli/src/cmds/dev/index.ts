import {ICliCommand, ICliCommandOptions} from "../../util";
import {IGlobalArgs} from "../../options";
import {devOptions, IDevArgs} from "./options";
import {devHandler} from "./handler";

export const dev: ICliCommand<IDevArgs, IGlobalArgs> = {
  command: "dev",
  describe: "Quickly bootstrap a beacon node and multiple validators. Use for development and testing",
  options: devOptions as ICliCommandOptions<IDevArgs>,
  handler: devHandler
};
