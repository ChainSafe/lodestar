import type {SecretKey} from "@chainsafe/bls/types";
import {PresetName} from "@lodestar/params";

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
  cleanupCommand?: string;
}

export enum Eth2Client {
  lodestar = "lodestar",
  lighthouse = "lighthouse",
}

export interface TestnetOpts {
  preset: PresetName;
  dataDir: string;
  genesisStateFilepath: string;
  configFilepath: string;
}

export interface BeaconProcessOpts extends TestnetOpts {
  client: Eth2Client;
  p2pPort: number;
  restPort: number;
  isSingleNode: boolean;
  genesisTime: number;
  logFilepath: string;
  logToStd: boolean;
  processName: string;
}

export interface LocalKeystores {
  useExternalSigner: false;
  keystores: string[];
  publicKeys: string[];
  password: string;
  // TODO: Remove once in memory Web3Signer is deprecreated
  secretKeys: SecretKey[];
}

export interface RemoteKeys {
  useExternalSigner: true;
  keymanagerUrl: string;
  publicKeys: string[];
}

export interface ValidatorProcessOpts extends TestnetOpts {
  client: Eth2Client;
  beaconUrl: string;
  keymanagerPort: number;
  genesisTime: number;
  logFilepath: string;
  logToStd: boolean;
  processName: string;
  signer: RemoteKeys | LocalKeystores;
}

export interface SubprocessForever {
  readonly pid: number;
  killGracefully(): Promise<void>;
}
