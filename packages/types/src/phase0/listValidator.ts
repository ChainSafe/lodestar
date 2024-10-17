import {ListCompositeType, ListCompositeTreeViewDU} from "@chainsafe/ssz";
import {Node} from "@chainsafe/persistent-merkle-tree";
import {ValidatorNodeStructType} from "./validator.js";
import {ListValidatorTreeViewDU} from "./viewDU/listValidator.js";

export class ListValidatorType extends ListCompositeType<ValidatorNodeStructType> {
  constructor(limit: number) {
    super(new ValidatorNodeStructType(), limit);
  }

  getViewDU(node: Node, cache?: unknown): ListCompositeTreeViewDU<ValidatorNodeStructType> {
    // biome-ignore lint/suspicious/noExplicitAny: ssz api
    return new ListValidatorTreeViewDU(this, node, cache as any);
  }
}
