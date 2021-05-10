import {createIBeaconConfig} from "@chainsafe/lodestar-config";
import {leveParams, leveGenesisTime} from "@chainsafe/lodestar-light-client/lib/leve";
import {fromHexString} from "@chainsafe/ssz";

export const config = createIBeaconConfig(leveParams);

export const genesisValidatorsRoot = fromHexString(
  "0xea569bcb4fbb2ed26d30e997d7337e7e12a43ac115793e9cbe25da401fcbb725"
);
export const stateRoot = fromHexString("0x96b09c52691647a6fd5f61e63c57c2f80db117096d1dd7e7e0df861e8f12a7d6");
export const trustedRoot = {stateRoot, slot: 0};
export const genesisTime = leveGenesisTime;
export const beaconApiUrl = "http://localhost:31000";
