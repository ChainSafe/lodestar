import {IBeaconParams} from "@chainsafe/lodestar-params";

export type IBeaconParamsUnparsed = Partial<{[P in keyof IBeaconParams]: string | number}>;
