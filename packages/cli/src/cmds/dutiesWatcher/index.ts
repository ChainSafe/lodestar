import {ICliCommand} from "../../util";
import {IGlobalArgs} from "../../options";
import {dutiesWatcherOptions, IDutiesWatcherArgs} from "./options";
import {dutiesWatcherHandler} from "./handler";

export const dutiesWatcher: ICliCommand<IDutiesWatcherArgs, IGlobalArgs> = {
  command: "dutiesWatcher",
  describe: "Run Duties Watcher",
  examples: [
    {
      command: "dutiesWatcher --network prater",
      description: "Run dutiesWatcher with prater network",
    },
  ],
  options: dutiesWatcherOptions,
  handler: dutiesWatcherHandler,
};
