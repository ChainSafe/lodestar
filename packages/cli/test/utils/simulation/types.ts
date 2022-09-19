import type {SecretKey} from "@chainsafe/bls/types";
import {Api} from "@lodestar/api";
import {Api as KeyManagerApi} from "@lodestar/api/keymanager";
import {IChainForkConfig} from "@lodestar/config";
import {BeaconStateAllForks} from "@lodestar/state-transition/";

export type SimulationRequiredParams = {
  beaconNodes: number;
  validatorClients: number;
  altairEpoch: number;
  bellatrixEpoch: number;
  logFilesDir: string;
};

export type SimulationOptionalParams = {
  validatorsPerClient: number;
  withExternalSigner: boolean;
  secondsPerSlot: number;
  genesisSlotsDelay: number;
  anchorState?: BeaconStateAllForks;
  externalSigner: boolean;
};

export type RunTimeSimulationParams = {
  genesisTime: number;
  slotsPerEpoch: number;
};

export interface BeaconNodeProcess {
  ready(): Promise<boolean>;
  start(): Promise<void>;
  stop(): Promise<void>;
  id: string;
  peerId?: string;
  multiaddrs: string[];
  api: Api;
  address: string;
  port: number;
  restPort: number;
  validatorClients: ValidatorProcess[];
}

export interface BeaconNodeConstructor {
  new (params: SimulationParams, rootDir: string): BeaconNodeProcess;
  totalProcessCount: number;
}

export interface ValidatorProcess {
  ready(): Promise<boolean>;
  start(): Promise<void>;
  stop(): Promise<void>;
  id: string;
  secretKeys: SecretKey[];
  keyManagerApi: KeyManagerApi;
}

export interface ValidatorConstructor {
  new (
    params: SimulationParams,
    options: {
      rootDir: string;
      clientIndex: number;
      server: string;
      config: IChainForkConfig;
    }
  ): ValidatorProcess;
  totalProcessCount: number;
}

export type SimulationParams = SimulationRequiredParams & Required<SimulationOptionalParams> & RunTimeSimulationParams;
