import path from "node:path";
import {IGlobalArgs} from "../../options/index.js";
import {getGlobalPaths} from "../../paths/global.js";

export type ILightclientPaths = {
  logFile?: string;
};

export function getLightclientPaths(
  args: Pick<IGlobalArgs, "dataDir"> & ILightclientPaths,
  network: string
): ILightclientPaths {
  // Compute global paths first
  const globalPaths = getGlobalPaths(args, network);

  const dataDir = globalPaths.dataDir;
  const logFile = args.logFile?.trim() !== "none" ? args.logFile ?? path.join(dataDir, "lightclient.log") : undefined;

  return {
    logFile,
  };
}

/**
 * Constructs representations of the path structure to show in command's description
 */
export const defaultLightclientPaths = getLightclientPaths({dataDir: "$dataDir"}, "$network");
