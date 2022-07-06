import {IChainConfig} from "@lodestar/config";

export type IBeaconParamsUnparsed = Partial<{[P in keyof IChainConfig]: string | number}>;
