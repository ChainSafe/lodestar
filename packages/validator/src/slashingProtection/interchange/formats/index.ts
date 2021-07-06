import {IInterchangeCompleteV4} from "./completeV4";
import {IInterchangeV5} from "./v5";

export type InterchangeFormat = {
  v4: IInterchangeCompleteV4;
  v5: IInterchangeV5;
};
