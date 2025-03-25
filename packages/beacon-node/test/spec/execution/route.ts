/**
 * Engine API routes are defined with `EngineApiRpcParamTypes` and `EngineApiRpcReturnTypes`.
 * They both are types and cannot be checked in run-time against spec test.
 * 
 * Need to define instance of EngineApiRpcParamTypes` and `EngineApiRpcReturnTypes` with dummy values
 * to be able to check the spec test.
 */

import { EngineApiRpcParamTypes } from "../../../src/execution/engine/types";


export const paramTypes: EngineApiRpcParamTypes;