import {SinonStubbedInstance} from "sinon";
import {IBeaconChain} from "../../../src/chain";

export type StubbedChain = IBeaconChain & SinonStubbedInstance<IBeaconChain>;

export * from "./beaconDb";
