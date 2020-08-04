import path from "path";
import {IGlobalArgs} from "../options";

export interface IGlobalPaths {
  rootDir: string;
  paramsFile: string;
}

/**
 * Defines the path structure of the globally used files
 *
 * ```bash
 * $rootDir
 * └── $paramsFile
 * ```
 */

export function getGlobalPaths(options: Partial<IGlobalArgs> & Pick<IGlobalArgs, "rootDir">): IGlobalPaths {
  // Set rootDir to testnet name iff rootDir is not set explicitly
  const rootDir = options.rootDir || (options.testnet ? `.${options.testnet}` : "./.lodestar");
  const paramsFile = path.join(rootDir, options.paramsFile || "config.yaml");
  return {
    rootDir,
    paramsFile,
  };
}

export const defaultGlobalPaths = getGlobalPaths({rootDir: "$rootDir"});
