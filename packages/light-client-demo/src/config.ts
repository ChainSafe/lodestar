import {createIBeaconConfig} from "@chainsafe/lodestar-config";
import {leveParams, leveGenesisTime} from "@chainsafe/lodestar-light-client/lib/leve";
import {fromHexString} from "@chainsafe/ssz";

const leveData = {
  genesisValidatorsRoot: "0x1f3cf9e4dd6ae2c6875068f194b1e2bbe9cbd78f5c99da95ef3c388b683828d9",
  genesisStateRoot: "0x32af56b3fb3d117e4132579fd54880cb25c91ec06685b16f4f97bdfe27600ce6",
};

export const config = createIBeaconConfig(leveParams);

export const genesisValidatorsRoot = fromHexString(leveData.genesisValidatorsRoot);
export const stateRoot = fromHexString(leveData.genesisStateRoot);
export const trustedRoot = {stateRoot, slot: 0};
export const genesisTime = leveGenesisTime;
export const beaconApiUrl = "http://localhost:31000";
