import {createIBeaconConfig} from "@chainsafe/lodestar-config";
import {leveParams, leveGenesisTime} from "@chainsafe/lodestar-light-client/lib/leve";
import {fromHexString} from "@chainsafe/ssz";

const leveData = {
  genesisStateRoot: "0x4035a830faa88d8d54c7772ac60d05c636c280d010b10deb8ae98f44ba5b92a3",
  genesisValidatorsRoot: "0xe0316c386ad87391354adbc2bcfa5d4f219d05fed4dddc7171579032055991d7",
};

export const config = createIBeaconConfig(leveParams);

export const genesisValidatorsRoot = fromHexString(leveData.genesisValidatorsRoot);
export const stateRoot = fromHexString(leveData.genesisStateRoot);
export const trustedRoot = {stateRoot, slot: 0};
export const genesisTime = leveGenesisTime;
export const beaconApiUrl = "http://localhost:31000";
