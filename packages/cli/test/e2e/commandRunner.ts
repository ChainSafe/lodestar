import {getLodestarCli} from "../../src/cli";

export function getLodestarCliTestRunner() {
  return async <T = any>(arg: string | readonly string[], context?: Record<string, unknown>): Promise<T> => {
    return new Promise((resolve, reject) => {
      const lodestar = getLodestarCli();
      lodestar
        // Called after the completion of any command. handler is invoked with the result returned by the command:
        .onFinishCommand((result) => {
          resolve(result);
        })
        // Method to execute when a failure occurs, rather than printing the failure message.
        .fail((msg, err) => {
          if (err !== undefined) reject(err);
          else if (msg) reject(Error(msg));
          else reject(Error("Unknown error"));
        })
        .help(false)
        .exitProcess(false)
        .parse(Array.isArray(arg) ? arg.join(" ") : arg, context);
    });
  };
}
