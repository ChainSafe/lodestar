import {ICliCommand} from "../../util";
import {IGlobalArgs} from "../../options";
import {devRunOptions, IDevOptions} from "./options";
import {run} from "./run";

export const dev: ICliCommand<IDevOptions, IGlobalArgs> = {
  command: "dev",
  describe: "Command used to quickly bootstrap beacon node and validators",
  options: devRunOptions,
  handler: run
};
