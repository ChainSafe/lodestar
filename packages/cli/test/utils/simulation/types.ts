import type {SecretKey} from "@chainsafe/bls/types";
import {Api} from "@lodestar/api";
import {ChainEvent} from "@lodestar/beacon-node/chain";
import {BeaconStateAllForks} from "@lodestar/state-transition/";

export type SimulationRequiredParams = {
  beaconNodes: number;
  validatorClients: number;
  altairEpoch: number;
  bellatrixEpoch: number;
  chainEvent: ChainEvent.justified | ChainEvent.finalized;
};

export type SimulationOptionalParams = {
  validatorsPerClient: number;
  withExternalSigner: boolean;
  slotsPerEpoch: number;
  secondsPerSlot: number;
  epochsOfMargin: number;
  timeoutSetupMargin: number;
  genesisSlotsDelay: number;
  anchorState?: BeaconStateAllForks;
};

export type RunTimeSimulationParams = {
  genesisTime: number;
  expectedTimeout: number;
};

export interface BeaconNodeProcess {
  ready(): Promise<boolean>;
  start(): Promise<void>;
  stop(): Promise<void>;
  secretKeys: Record<number, SecretKey[]>;
  api: Api;
}

export interface BeaconNodeConstructor {
  new (params: SimulationParams, rootDir: string): BeaconNodeProcess;
}

export type SimulationParams = SimulationRequiredParams & Required<SimulationOptionalParams> & RunTimeSimulationParams;
