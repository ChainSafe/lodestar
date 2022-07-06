import {SinonStubbedInstance} from "sinon";
import {IBeaconChain} from "../../../src/chain/index.js";

export type StubbedChain = IBeaconChain & SinonStubbedInstance<IBeaconChain>;

export * from "./beaconDb.js";
