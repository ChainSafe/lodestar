import path from "node:path";
import {IGlobalArgs} from "../../../options/index.js";
import {getGlobalPaths} from "../../../paths/global.js";

export type ISlashingProtectionPaths = {
  logFile?: string;
};

export function getSlashingProtectionPaths(
  args: Pick<IGlobalArgs, "dataDir"> & ISlashingProtectionPaths,
  network: string,
  defaultFilePrefix = ""
): ISlashingProtectionPaths {
  // Compute global paths first
  const globalPaths = getGlobalPaths(args, network);

  const dataDir = globalPaths.dataDir;
  const logFile =
    args.logFile?.trim() !== "none"
      ? args.logFile ?? path.join(dataDir, `${defaultFilePrefix}slashing-protection.log`)
      : undefined;

  return {
    logFile,
  };
}

/**
 * Constructs representations of the path structure to show in command's description
 */
export const defaultSlashingProtectionPaths = getSlashingProtectionPaths(
  {dataDir: "$dataDir"},
  "$network",
  "(import|export)-"
);
