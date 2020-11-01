import {IGlobalArgs} from "../../options";
import {getGlobalPaths, IGlobalPaths} from "../../paths/global";
import {joinIfRelative} from "../../util";

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
 * Defines the path structure of the account files
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
  const dbDir = joinIfRelative(beaconDir, args.dbDir || "chain-db");
  const peerStoreDir = joinIfRelative(beaconDir, args.dbDir || "peerstore");
  const configFile = joinIfRelative(beaconDir, args.configFile || "beacon.config.json");
  const peerIdFile = joinIfRelative(beaconDir, args.peerIdFile || "peer-id.json");
  const enrFile = joinIfRelative(beaconDir, args.enrFile || "enr");
  const logFile = args.logFile && joinIfRelative(beaconDir, args.logFile);

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
