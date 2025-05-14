import {LodestarError} from "@lodestar/utils";

export enum HierarchicalLayersErrorCode {
  InvalidLayerEpoch = "ERROR_INVALID_LAYER_EPOCH",
  InvalidOrder = "ERROR_INVALID_ORDER",
  EmptyEpochs = "ERROR_EMPTY_EPOCHS",
  DuplicateEpochs = "ERROR_DUPLICATE_EPOCHS",
  MinLayers = "ERROR_MIN_LAYERS",
}

export type HierarchicalLayersErrorType = {
  code: HierarchicalLayersErrorCode;
};

export class HierarchicalLayersError extends LodestarError<HierarchicalLayersErrorType> {}
