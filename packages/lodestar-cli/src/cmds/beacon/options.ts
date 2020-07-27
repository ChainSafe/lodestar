import {Options} from "yargs";
import {IGlobalArgs} from "../../options";
import {beaconNodeOptions, IBeaconNodeOptions} from "../../options/beaconNodeOptions";
import {paramsOptions, IParamsOptions} from "../../options/paramsOptions";
import {defaultBeaconPaths, IBeaconPaths} from "./paths";
import {TestnetName} from "./testnets";

export type IBeaconOptions =
  IGlobalArgs &
  IBeaconNodeOptions &
  IParamsOptions &
  IBeaconPaths &
  {
    templateConfigFile?: string;
    genesisStateFile?: string;
    testnet?: TestnetName;
  };

export const beaconOptions = {
  ...beaconNodeOptions,
  ...paramsOptions,

  templateConfigFile: {
    alias: ["templateConfigFile", "templateConfig"],
    description: "Template configuration used to initialize beacon node",
    type: "string",
    default: null,
  } as Options,

  genesisStateFile: {
    description: "Genesis state in ssz-encoded format",
    type: "string",
    normalize: true,
  } as Options,

  testnet: {
    description: "Use a testnet configuration and genesis file",
    type: "string",
    choices: ["altona"] as TestnetName[],
  } as Options,

  // Beacon paths

  beaconDir: {
    description: "Beacon root dir",
    defaultDescription: defaultBeaconPaths.beaconDir,
    hidden: true,
    type: "string",
  } as Options,

  dbDir: {
    alias: ["db.dir", "db.name"],
    description: "Beacon DB dir",
    defaultDescription: defaultBeaconPaths.dbDir,
    hidden: true,
    normalize: true,
    type: "string",
  } as Options,

  configFile: {
    alias: ["config"],
    description: "Beacon node configuration file",
    defaultDescription: defaultBeaconPaths.configFile,
    type: "string",
    normalize: true,
  } as Options,

  peerIdFile: {
    hidden: true,
    description: "Peer ID file",
    defaultDescription: defaultBeaconPaths.peerIdFile,
    normalize: true,
    type: "string",
  } as Options,

  enrFile: {
    hidden: true,
    description: "ENR file",
    defaultDescription: defaultBeaconPaths.enrFile,
    normalize: true,
    type: "string",
  } as Options
};
