import {SinonStubbedInstance} from "sinon";
import {IBeaconChain} from "../../../src/chain/index.js";
import {Mutable} from "../types.js";

export type StubbedChain = IBeaconChain & SinonStubbedInstance<IBeaconChain>;
export type StubbedOf<T> = T & SinonStubbedInstance<T>;

/** Helper type to make dependencies mutable for validation tests */
export type StubbedChainMutable<K extends keyof IBeaconChain> = StubbedOf<Mutable<IBeaconChain, K>>;

export * from "./beaconDb.js";
