import {CompactMultiProof} from "@chainsafe/persistent-merkle-tree";
import {routes} from "@lodestar/api";
import {ApplicationMethods} from "@lodestar/api/server";
import {createCompactMultiProof} from "@lodestar/state-transition";
import {ApiOptions} from "../../options.js";
import {getBlockResponse} from "../beacon/blocks/utils.js";
import {getStateResponseWithRegen} from "../beacon/state/utils.js";
import {ValidationError} from "../errors.js";
import {ApiModules} from "../types.js";
import {validateProofRequest} from "./validation.js";

export function getProofApi(
  opts: ApiOptions,
  {chain, config, sync}: Pick<ApiModules, "chain" | "config" | "db" | "sync">
): ApplicationMethods<routes.proof.Endpoints> {
  const maxGindicesInProof = opts.maxGindicesInProof ?? 512;
  if (!Number.isSafeInteger(maxGindicesInProof) || maxGindicesInProof < 0) {
    throw Error("maxGindicesInProof must be a non-negative safe integer");
  }
  const maxDescriptorBytes = Math.min(
    maxGindicesInProof * 2,
    routes.proof.CompactMultiProofType.fields.descriptor.limitBytes
  );

  return {
    async getStateProof({stateId, descriptor}) {
      validateProofRequest(stateId, descriptor, maxDescriptorBytes);

      const res = await getStateResponseWithRegen(chain, sync, stateId);

      const state = res.state instanceof Uint8Array ? chain.getHeadState().loadOtherState(res.state) : res.state;

      try {
        return {
          data: createProofWithValidation(() => state.createMultiProof(descriptor)),
          meta: {version: config.getForkName(state.slot)},
        };
      } finally {
        if (res.state instanceof Uint8Array) state.release();
      }
    },
    async getBlockProof({blockId, descriptor}) {
      validateProofRequest(blockId.toLowerCase(), descriptor, maxDescriptorBytes);

      const {block} = await getBlockResponse(chain, blockId);

      const blockNode = config.getForkTypes(block.message.slot).BeaconBlock.toView(block.message).node;

      const proof = createProofWithValidation(() => createCompactMultiProof(blockNode, descriptor));

      return {
        data: proof,
        meta: {version: config.getForkName(block.message.slot)},
      };
    },
  };
}

function createProofWithValidation(create: () => CompactMultiProof): CompactMultiProof {
  try {
    return create();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "INVALID_PROOF_TRAVERSAL") {
      throw new ValidationError(error.message);
    }
    throw error;
  }
}
