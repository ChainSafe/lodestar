import path from "path";
import {IGlobalArgs} from "../../options";

export interface IBeaconPaths {
  beaconDir: string;
  dbDir: string;
  configFile: string;
  network: {
    peerIdFile: string;
    enrFile: string;
  };
}

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
  const rootDir = options.rootDir;
  const beaconDir = path.join(rootDir, options.beaconDir || "beacon");
  const dbDir = path.join(beaconDir, options.dbDir || "chain-db");
  const configFile = path.join(beaconDir, options.configFile || "beacon.config.json");
  const peerIdFile = path.join(beaconDir, options.network?.peerIdFile || "peer-id.json");
  const enrFile = path.join(beaconDir, options.network?.enrFile || "enr.json");
  
  return {
    beaconDir,
    dbDir,
    configFile,
    network: {
      peerIdFile,
      enrFile
    }
  };
}

/**
 * Constructs representations of the path structure to show in command's description
 */
export const defaultBeaconPaths = getBeaconPaths({rootDir: "$rootDir"});
