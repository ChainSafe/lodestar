import {IChainConfig} from "@chainsafe/lodestar-config";

export type IBeaconParamsUnparsed = Partial<{[P in keyof IChainConfig]: string | number}>;
