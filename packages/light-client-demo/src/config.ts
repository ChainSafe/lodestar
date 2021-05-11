import {createIBeaconConfig} from "@chainsafe/lodestar-config";
import {leveParams, leveGenesisTime} from "@chainsafe/lodestar-light-client/lib/leve";
import {fromHexString} from "@chainsafe/ssz";

const leveData = {
  genesisStateRoot: "0x015abe432b7c66fb022c76a713c035f6924c90e883edda75c1f7cff285b29497",
  genesisValidatorsRoot: "0xe0316c386ad87391354adbc2bcfa5d4f219d05fed4dddc7171579032055991d7",
};

export const config = createIBeaconConfig(leveParams);

export const genesisValidatorsRoot = fromHexString(leveData.genesisValidatorsRoot);
export const stateRoot = fromHexString(leveData.genesisStateRoot);
export const trustedRoot = {stateRoot, slot: 0};
export const genesisTime = leveGenesisTime;
// Temp PROD: http://161.97.179.211:31000
export const beaconApiUrl = "http://161.97.179.211:31000";
