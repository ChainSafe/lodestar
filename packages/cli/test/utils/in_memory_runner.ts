import yargs from "yargs";
import {getLodestarCli} from "../../src/cli.js";

export function getCliInMemoryRunner() {
  return async (arg: string | readonly string[], context?: Record<string, unknown>): Promise<void> => {
    return new Promise((resolve, reject) => {
      const lodestar = getLodestarCli() as yargs.Argv<any>;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      lodestar
        // Method to execute when a failure occurs, rather than printing the failure message.
        .fail((msg, err) => {
          if (err !== undefined) reject(err);
          else if (msg) reject(Error(msg));
          else reject(Error("Unknown error"));
        })
        .help(false)
        .exitProcess(false)
        .parse(Array.isArray(arg) ? arg.join(" ") : arg, context)
        // Called after the completion of any command. handler is invoked with the result returned by the command:
        .then((result: any) => {
          resolve(result);
        })
        .catch((e: unknown) => reject(e));
    });
  };
}
