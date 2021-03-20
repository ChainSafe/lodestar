/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
export interface ILodestarApi {
  getWtfNode(): string;
}

export class LodestarApi implements ILodestarApi {
  constructor() {
    // Allows to load wtfnode listeners immedeatelly. Usefull when dockerized,
    // so after an unexpected restart wtfnode becomes properly loaded again
    if (process?.env?.START_WTF_NODE) {
      // eslint-disable-next-line
      require("wtfnode");
    }
  }

  /**
   * Get a wtfnode dump of all active handles
   * Will only load the wtfnode after the first call, and registers async hooks
   * and other listeners to the global process instance
   */
  getWtfNode(): string {
    // Browser interop
    if (typeof require !== "function") throw Error("NodeJS only");

    // eslint-disable-next-line
    const wtfnode = require("wtfnode");
    const logs: string[] = [];
    function logger(...args: string[]): void {
      for (const arg of args) logs.push(arg);
    }
    wtfnode.setLogger("info", logger);
    wtfnode.setLogger("warn", logger);
    wtfnode.setLogger("error", logger);
    wtfnode.dump();
    return logs.join("\n");
  }
}
