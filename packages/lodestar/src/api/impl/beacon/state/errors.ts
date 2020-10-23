import {ApiError} from "../../errors/api";

export class MissingState extends ApiError {
  constructor(message?: string) {
    super(404, message ?? "Couldn't find beacon state");
  }
}
