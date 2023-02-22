import path from "node:path";
import {GlobalArgs} from "../../options/index.js";
import {getGlobalPaths, GlobalPaths} from "../../paths/global.js";

export type BeaconPathsPartial = Partial<{
  beaconDir: string;
  peerStoreDir: string;
  dbDir: string;
  persistInvalidSszObjectsDir: string;
}>;

export type BeaconPaths = {
  beaconDir: string;
  peerStoreDir: string;
  dbDir: string;
  persistInvalidSszObjectsDir: string;
};

/**
 * Defines the path structure of the files relevant to the beacon node
 *
 * ```bash
 * $dataDir
 * └── $beaconDir
 *     ├── beacon.config.json
 *     ├── peer-id.json
 *     ├── enr
 *     ├── chain-db
 *     └── beacon.log
 * ```
 */
export function getBeaconPaths(
  // Using Pick<GlobalArgs, "dataDir"> make changes in GlobalArgs throw a type error here
  args: BeaconPathsPartial & Pick<GlobalArgs, "dataDir">,
  network: string
): GlobalPaths & Required<BeaconPathsPartial> {
  // Compute global paths first
  const globalPaths = getGlobalPaths(args, network);

  const dataDir = globalPaths.dataDir;
  const beaconDir = dataDir;
  const dbDir = args.dbDir ?? path.join(beaconDir, "chain-db");
  const persistInvalidSszObjectsDir = args.persistInvalidSszObjectsDir ?? path.join(beaconDir, "invalidSszObjects");
  const peerStoreDir = args.peerStoreDir ?? path.join(beaconDir, "peerstore");

  return {
    ...globalPaths,
    beaconDir,
    dbDir,
    persistInvalidSszObjectsDir,
    peerStoreDir,
  };
}

/**
 * Constructs representations of the path structure to show in command's description
 */
export const defaultBeaconPaths = getBeaconPaths({dataDir: "$dataDir"}, "$network");
