import {BasicType} from "./basic";
import {CompositeType} from "./composite";

/**
 * A Type is either a BasicType or a CompositeType.
*/
export type Type<T> = BasicType<T> | (T extends object ? CompositeType<T>: never);
