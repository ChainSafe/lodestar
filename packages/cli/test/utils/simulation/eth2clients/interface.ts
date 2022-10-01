import type {SecretKey} from "@chainsafe/bls/types";

export interface BeaconNodeProcess {
  ready(): Promise<boolean>;
  start(): Promise<void>;
  stop(): Promise<void>;
  id: string;
  idNum: number;
  peerId?: string;
  multiaddrs: string[];
  address: string;
  port: number;
  restPort: number;
}

export interface SpwanOpts {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export enum Eth2Client {
  lodestar = "lodestar",
}

export interface BeaconProcessOpts {
  client: Eth2Client;
  p2pPort: number;
  restPort: number;
  isSingleNode: boolean;
  genesisTime: number;
  dataDir: string;
  genesisStateFilepath: string;
  configFilepath: string;
  logFilepath: string;
  logToStd: boolean;
}

export interface LocalKeystores {
  useExternalSigner: false;
  keystores: string[];
  password: string;
  // TODO: Remove once in memory Web3Signer is deprecreated
  secretKeys: SecretKey[];
}

export interface RemoteKeys {
  useExternalSigner: true;
  keymanagerUrl: string;
  publicKeys: string[];
}

export interface ValidatorProcessOpts {
  client: Eth2Client;
  beaconUrl: string;
  keymanagerPort: number;
  genesisTime: number;
  dataDir: string;
  configFilepath: string;
  logFilepath: string;
  logToStd: boolean;
  signer: RemoteKeys | LocalKeystores;
}
