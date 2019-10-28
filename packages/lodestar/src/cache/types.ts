/**
 * @module cache
 */

import {AnySSZType} from "@chainsafe/ssz-type-schema";

export type CacheId = Buffer | string | number;

export type CacheIdFunction<T> = (value: T, sszType: AnySSZType) => CacheId;