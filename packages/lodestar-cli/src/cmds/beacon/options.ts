import {Options} from "yargs";
import {withDefaultValue} from "../../util";
import {IGlobalArgs} from "../../options";
import {beaconNodeOptions, IBeaconNodeOptions} from "../../options/beaconNodeOptions";
import {paramsOptions, IParamsOptions} from "../../options/paramsOptions";
import {genesisStateFileOptions, IGenesisStateFileOptions} from "../../options/otherOptions";
import {defaultBeaconPaths, IBeaconPaths} from "./paths";
import {TestnetName} from "./testnets";

export type IBeaconOptions =
  IGlobalArgs &
  IBeaconNodeOptions &
  IParamsOptions &
  IGenesisStateFileOptions &
  IBeaconPaths &
  {
    templateConfigFile?: string;
    testnet?: TestnetName;
  };

export const beaconOptions = {
  ...beaconNodeOptions,
  ...paramsOptions,
  ...genesisStateFileOptions,

  "templateConfigFile": {
    alias: ["templateConfigFile", "templateConfig"],
    description: "Template configuration used to initialize beacon node",
    type: "string",
    default: null,
  } as Options,

  "testnet": {
    description: "Use a testnet configuration and genesis file",
    type: "string",
    choices: ["altona"] as TestnetName[],
  } as Options,

  // Beacon paths

  beaconDir: {
    description: withDefaultValue("Beacon root dir", defaultBeaconPaths.beaconDir),
    hidden: true,
    type: "string",
  } as Options,

  dbDir: {
    alias: ["db.dir", "db.name"],
    description: withDefaultValue("Beacon DB dir", defaultBeaconPaths.dbDir),
    hidden: true,
    normalize: true,
    type: "string",
  } as Options,

  configFile: {
    alias: ["config"],
    description: withDefaultValue("Beacon node configuration file", defaultBeaconPaths.configFile),
    type: "string",
    normalize: true,
  } as Options,

  "network.peerIdFile": {
    hidden: true,
    description: withDefaultValue("Peer ID file", defaultBeaconPaths.network.peerIdFile),
    normalize: true,
    type: "string",
  } as Options,

  "network.enrFile": {
    hidden: true,
    description: withDefaultValue("ENR file", defaultBeaconPaths.network.enrFile),
    normalize: true,
    type: "string",
  } as Options
};
