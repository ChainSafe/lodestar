import {IGlobalArgs} from "../options";
import {getDefaultRootDir} from "./rootDir";

export interface IGlobalPaths {
  rootDir: string;
  paramsFile?: string;
}

/**
 * Defines the path structure of the globally used files
 *
 * ```bash
 * $rootDir
 * └── $paramsFile
 * ```
 */
export function getGlobalPaths(args: Partial<IGlobalArgs>): IGlobalPaths {
  // Set rootDir to network name iff rootDir is not set explicitly
  const rootDir = args.rootDir || getDefaultRootDir(args.network);
  const paramsFile = args.paramsFile;
  return {
    rootDir,
    paramsFile,
  };
}

export const defaultGlobalPaths = getGlobalPaths({rootDir: "$rootDir"});
