import path from "path";
import {IGlobalArgs} from "../../options";
import {getGlobalPaths, IGlobalPaths} from "../../paths/global";

export interface IBeaconPaths {
  beaconDir: string;
  peerStoreDir: string;
  dbDir: string;
  configFile: string;
  peerIdFile: string;
  enrFile: string;
  logFile?: string;
}

/**
 * Defines the path structure of the files relevant to the beacon node
 *
 * ```bash
 * $rootDir
 * └── $beaconDir
 *     ├── beacon.config.json
 *     ├── peer-id.json
 *     ├── enr
 *     └── chain-db
 * ```
 */
// Using Pick<IGlobalArgs, "rootDir"> make changes in IGlobalArgs throw a type error here
export function getBeaconPaths(
  args: Partial<IBeaconPaths> & Pick<IGlobalArgs, "rootDir">
): IBeaconPaths & IGlobalPaths {
  // Compute global paths first
  const globalPaths = getGlobalPaths(args);

  const rootDir = globalPaths.rootDir;
  const beaconDir = rootDir;
  const dbDir = args.dbDir || path.join(beaconDir, "chain-db");
  const peerStoreDir = args.peerStoreDir || path.join(beaconDir, "peerstore");
  const configFile = args.configFile || path.join(beaconDir, "beacon.config.json");
  const peerIdFile = args.peerIdFile || path.join(beaconDir, "peer-id.json");
  const enrFile = args.enrFile || path.join(beaconDir, "enr");
  const logFile = args.logFile;

  return {
    ...globalPaths,
    beaconDir,
    dbDir,
    configFile,
    peerStoreDir,
    peerIdFile,
    enrFile,
    logFile,
  };
}

/**
 * Constructs representations of the path structure to show in command's description
 */
export const defaultBeaconPaths = getBeaconPaths({rootDir: "$rootDir"});
