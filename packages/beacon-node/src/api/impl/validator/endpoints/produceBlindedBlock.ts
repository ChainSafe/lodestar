import {ServerApi, routes} from "@lodestar/api";
import {allForks, isBlindedBeaconBlock, isBlockContents} from "@lodestar/types";
import {isForkExecution} from "@lodestar/params";
import {beaconBlockToBlinded} from "@lodestar/state-transition";
import {ApiModules} from "../../types.js";
import {ValidatorEndpointDependencies} from "./types.js";

export function buildProduceBlindedBlock(
  {config}: ApiModules,
  {produceBlockV3}: ValidatorEndpointDependencies & {produceBlockV3: ServerApi<routes.validator.Api>["produceBlockV3"]}
): ServerApi<routes.validator.Api>["produceBlindedBlock"] {
  return async function produceBlindedBlock(slot, randaoReveal, graffiti) {
    const {data, executionPayloadValue, consensusBlockValue, version} = await produceBlockV3(
      slot,
      randaoReveal,
      graffiti
    );
    if (!isForkExecution(version)) {
      throw Error(`Invalid fork=${version} for produceEngineOrBuilderBlindedBlock`);
    }
    const executionPayloadBlinded = true;

    if (isBlockContents(data)) {
      const {block} = data;
      const blindedBlock = beaconBlockToBlinded(config, block as allForks.AllForksExecution["BeaconBlock"]);
      return {executionPayloadValue, consensusBlockValue, data: blindedBlock, executionPayloadBlinded, version};
    } else if (isBlindedBeaconBlock(data)) {
      return {executionPayloadValue, consensusBlockValue, data, executionPayloadBlinded, version};
    } else {
      const blindedBlock = beaconBlockToBlinded(config, data as allForks.AllForksExecution["BeaconBlock"]);
      return {executionPayloadValue, consensusBlockValue, data: blindedBlock, executionPayloadBlinded, version};
    }
  };
}
