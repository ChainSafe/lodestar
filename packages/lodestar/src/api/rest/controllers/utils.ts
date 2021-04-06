import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ValidatorIndex, BLSPubkey} from "@chainsafe/lodestar-types";
import {FastifyError} from "fastify";

/**
 * The error handler will decide status code 400
 */
export function toRestValidationError(field: string, message: string): FastifyError {
  return {
    message,
    validation: [
      {
        dataPath: field,
        message,
      },
    ],
  } as FastifyError;
}

export function mapValidatorIndices(config: IBeaconConfig, data: string[]): (ValidatorIndex | BLSPubkey)[] {
  return data.map((id) => {
    if (id.toLowerCase().startsWith("0x")) {
      return config.types.BLSPubkey.fromJson(id);
    } else {
      return config.types.ValidatorIndex.fromJson(id);
    }
  });
}
