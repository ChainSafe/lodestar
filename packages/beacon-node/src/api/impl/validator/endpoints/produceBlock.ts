import {ServerApi, routes} from "@lodestar/api";
import {isForkBlobs} from "@lodestar/params";
import {allForks} from "@lodestar/types";
import {ApiModules} from "../../types.js";
import {ValidatorEndpointDependencies} from "./types.js";

export function buildProduceBlock(
  _modules: ApiModules,
  {produceBlockV2}: ValidatorEndpointDependencies & {produceBlockV2: ServerApi<routes.validator.Api>["produceBlockV2"]}
): ServerApi<routes.validator.Api>["produceBlock"] {
  return async function produceBlock(slot, randaoReveal, graffiti) {
    const producedData = await produceBlockV2(slot, randaoReveal, graffiti);
    if (isForkBlobs(producedData.version)) {
      throw Error(`Invalid call to produceBlock for deneb+ fork=${producedData.version}`);
    } else {
      // TODO: need to figure out why typescript requires typecasting here
      // by typing of produceFullBlockOrContents respose it should have figured this out itself
      return producedData as {data: allForks.BeaconBlock};
    }
  };
}
