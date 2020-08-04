import path from "path";

import {IGlobalArgs} from "../../options";
import {getGlobalPaths, IGlobalPaths} from "../../paths/global";

export type IBeaconPaths = IGlobalPaths & {
  beaconDir: string;
  peerStoreDir: string;
  dbDir: string;
  configFile: string;
  peerIdFile: string;
  enrFile: string;
};

/**
 * Defines the path structure of the account files
 *
 * ```bash
 * $rootDir
 * └── $beaconDir
 *     ├── beacon.config.json
 *     ├── peer-id.json
 *     ├── enr.json
 *     └── chain-db
 * ```
 */
// Using Pick<IGlobalArgs, "rootDir"> make changes in IGlobalArgs throw a type error here
export function getBeaconPaths(options: Partial<IBeaconPaths> & Pick<IGlobalArgs, "rootDir">): IBeaconPaths {
  options = {
    ...options,
    ...getGlobalPaths(options),
  };
  const rootDir = options.rootDir;
  const beaconDir = rootDir;
  const dbDir = path.join(beaconDir, options.dbDir || "chain-db");
  const peerStoreDir = path.join(beaconDir, options.dbDir || "peerstore");
  const configFile = path.join(beaconDir, options.configFile || "beacon.config.json");
  const peerIdFile = path.join(beaconDir, options.peerIdFile || "peer-id.json");
  const enrFile = path.join(beaconDir, options.enrFile || "enr.json");

  return {
    ...options,
    beaconDir,
    dbDir,
    configFile,
    peerStoreDir,
    peerIdFile,
    enrFile
  } as IBeaconPaths;
}

/**
 * Constructs representations of the path structure to show in command's description
 */
export const defaultBeaconPaths = getBeaconPaths({rootDir: "$rootDir"});
