import {IGlobalArgs} from "../options";
import {joinIfRelative} from "../util";

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

export function getGlobalPaths(args: Partial<IGlobalArgs> & Pick<IGlobalArgs, "rootDir">): IGlobalPaths {
  // Set rootDir to testnet name iff rootDir is not set explicitly
  const rootDir = args.rootDir || (args.testnet ? `.${args.testnet}` : "./.lodestar");
  const paramsFile = joinIfRelative(rootDir, args.paramsFile || "config.yaml");
  return {
    rootDir,
    paramsFile,
  };
}

export const defaultGlobalPaths = getGlobalPaths({rootDir: "$rootDir"});
