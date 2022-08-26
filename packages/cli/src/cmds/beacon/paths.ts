import path from "node:path";
import {IGlobalArgs} from "../../options/index.js";
import {getGlobalPaths, IGlobalPaths} from "../../paths/global.js";

export interface IBeaconPaths {
  beaconDir: string;
  peerStoreDir: string;
  dbDir: string;
  persistInvalidSszObjectsDir: string;
  enrFile: string;
  logFile?: string;
}

/**
 * Defines the path structure of the files relevant to the beacon node
 *
 * ```bash
 * $dataDir
 * └── $beaconDir
 *     ├── beacon.config.json
 *     ├── peer-id.json
 *     ├── enr
 *     └── chain-db
 * ```
 */
// Using Pick<IGlobalArgs, "dataDir"> make changes in IGlobalArgs throw a type error here
export function getBeaconPaths(
  args: Partial<IBeaconPaths> & Pick<IGlobalArgs, "dataDir">,
  network: string
): IBeaconPaths & IGlobalPaths {
  // Compute global paths first
  const globalPaths = getGlobalPaths(args, network);

  const dataDir = globalPaths.dataDir;
  const beaconDir = dataDir;
  const dbDir = args.dbDir || path.join(beaconDir, "chain-db");
  const persistInvalidSszObjectsDir = args.persistInvalidSszObjectsDir || path.join(beaconDir, "invalidSszObjects");
  const peerStoreDir = args.peerStoreDir || path.join(beaconDir, "peerstore");
  const enrFile = args.enrFile || path.join(beaconDir, "enr");
  const logFile = args.logFile;

  return {
    ...globalPaths,
    beaconDir,
    dbDir,
    persistInvalidSszObjectsDir,
    peerStoreDir,
    enrFile,
    logFile,
  };
}

/**
 * Constructs representations of the path structure to show in command's description
 */
export const defaultBeaconPaths = getBeaconPaths({dataDir: "$dataDir"}, "$network");
