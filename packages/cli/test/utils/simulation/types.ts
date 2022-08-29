import type {SecretKey} from "@chainsafe/bls/types";
import {Api} from "@lodestar/api";
import {BeaconStateAllForks} from "@lodestar/state-transition/";

export type SimulationRequiredParams = {
  beaconNodes: number;
  validatorClients: number;
  altairEpoch: number;
  bellatrixEpoch: number;
};

export type SimulationOptionalParams = {
  validatorsPerClient: number;
  withExternalSigner: boolean;
  slotsPerEpoch: number;
  secondsPerSlot: number;
  genesisSlotsDelay: number;
  anchorState?: BeaconStateAllForks;
};

export type RunTimeSimulationParams = {
  genesisTime: number;
};

export interface BeaconNodeProcess {
  ready(): Promise<boolean>;
  start(): Promise<void>;
  stop(): Promise<void>;
  secretKeys: Record<number, SecretKey[]>;
  api: Api;
  address: string;
  port: number;
  restPort: number;
}

export interface BeaconNodeConstructor {
  new (params: SimulationParams, rootDir: string): BeaconNodeProcess;
}

export type SimulationParams = SimulationRequiredParams & Required<SimulationOptionalParams> & RunTimeSimulationParams;
