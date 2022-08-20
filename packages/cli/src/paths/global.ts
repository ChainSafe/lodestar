import {IGlobalArgs} from "../options/index.js";
import {getDefaultDataDir} from "./rootDir.js";

export interface IGlobalPaths {
  dataDir: string;
  paramsFile?: string;
}

/**
 * Defines the path structure of the globally used files
 *
 * ```bash
 * $dataDir
 * └── $paramsFile
 * ```
 */
export function getGlobalPaths(args: Partial<IGlobalArgs>): IGlobalPaths {
  // Set dataDir to network name iff dataDir is not set explicitly
  const dataDir = args.dataDir || getDefaultDataDir(args.network);
  const paramsFile = args.paramsFile;
  return {
    dataDir,
    paramsFile,
  };
}

export const defaultGlobalPaths = getGlobalPaths({dataDir: "$dataDir"});
