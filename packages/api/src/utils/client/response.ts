import {ApiError} from "../error.js";
import {WireFormat, getWireFormat, parseContentTypeHeader} from "../headers.js";
import {HttpStatusCode} from "../httpStatusCode.js";
import {Endpoint} from "../types.js";
import {RouteDefinitionExtra} from "./request.js";

export type RawBody =
  | {type: WireFormat.json; value: unknown}
  | {type: WireFormat.ssz; value: Uint8Array}
  | {type?: never; value?: never};

export class ApiResponse<E extends Endpoint> extends Response {
  private definition: RouteDefinitionExtra<E>;
  private _wireFormat?: WireFormat | null;
  private _rawBody?: RawBody;
  private _errorBody?: string;
  private _meta?: E["meta"];
  private _value?: E["return"];

  constructor(definition: RouteDefinitionExtra<E>, body?: BodyInit | null, init?: ResponseInit) {
    super(body, init);
    this.definition = definition;
  }

  wireFormat(): WireFormat | null {
    if (this._wireFormat === undefined) {
      if (this.definition.resp.isEmpty) {
        return (this._wireFormat = null);
      }

      const contentType = this.headers.get("content-type");
      if (contentType === null) {
        if (this.status === HttpStatusCode.NO_CONTENT) {
          return (this._wireFormat = null);
        } else {
          throw Error("Content-Type header is required in response");
        }
      }

      const mediaType = parseContentTypeHeader(contentType);
      if (mediaType === null) {
        throw Error(`Unsupported response media type: ${contentType.split(";", 1)[0]}`);
      }

      const wireFormat = getWireFormat(mediaType);

      const {onlySupport} = this.definition.resp;
      if (onlySupport !== undefined && wireFormat !== onlySupport) {
        throw Error(`Method only supports ${onlySupport} responses`);
      }

      this._wireFormat = wireFormat;
    }
    return this._wireFormat;
  }

  async rawBody(): Promise<RawBody> {
    if (!this.ok) {
      throw await this.error();
    }

    if (!this._rawBody) {
      switch (this.wireFormat()) {
        case WireFormat.json:
          this._rawBody = {
            type: WireFormat.json,
            value: await super.json(),
          };
          break;
        case WireFormat.ssz:
          this._rawBody = {
            type: WireFormat.ssz,
            value: new Uint8Array(await this.arrayBuffer()),
          };
          break;
        default:
          this._rawBody = {};
      }
    }
    return this._rawBody;
  }

  async meta(): Promise<E["meta"]> {
    if (!this.ok) {
      throw await this.error();
    }

    if (!this._meta) {
      switch (this.wireFormat()) {
        case WireFormat.json: {
          const rawBody = await this.rawBody();
          const metaJson = this.definition.resp.transform
            ? this.definition.resp.transform.fromResponse(rawBody.value).meta
            : rawBody.value;
          this._meta = this.definition.resp.meta.fromJson(metaJson);
          break;
        }
        case WireFormat.ssz:
          this._meta = this.definition.resp.meta.fromHeaders(this.headers);
          break;
      }
    }
    return this._meta;
  }

  async value(): Promise<E["return"]> {
    if (!this._value) {
      const rawBody = await this.rawBody();
      const meta = await this.meta();
      switch (rawBody.type) {
        case WireFormat.json: {
          const dataJson = this.definition.resp.transform
            ? this.definition.resp.transform.fromResponse(rawBody.value).data
            : (rawBody.value as Record<string, unknown>)?.data;
          this._value = this.definition.resp.data.fromJson(dataJson, meta);
          break;
        }
        case WireFormat.ssz:
          this._value = this.definition.resp.data.deserialize(rawBody.value, meta);
          break;
      }
    }
    return this._value;
  }

  async json(): Promise<unknown> {
    const rawBody = await this.rawBody();
    switch (rawBody.type) {
      case WireFormat.json:
        return rawBody.value;
      case WireFormat.ssz:
        return this.definition.resp.data.toJson(await this.value(), await this.meta());
      default:
        return {};
    }
  }

  async ssz(): Promise<Uint8Array> {
    const rawBody = await this.rawBody();
    switch (rawBody.type) {
      case WireFormat.json:
        return this.definition.resp.data.serialize(await this.value(), await this.meta());
      case WireFormat.ssz:
        return rawBody.value;
      default:
        return new Uint8Array();
    }
  }

  async error(): Promise<ApiError | null> {
    if (this.ok) {
      return null;
    }
    if (!this._errorBody) {
      this._errorBody = await this.text();
    }
    return new ApiError(getErrorMessage(this._errorBody), this.status, this.definition.operationId);
  }
}

function getErrorMessage(errBody: string): string {
  try {
    const errJson = JSON.parse(errBody) as {message?: string};
    if (errJson.message) {
      return errJson.message;
    } else {
      return errBody;
    }
  } catch (e) {
    return errBody;
  }
}
