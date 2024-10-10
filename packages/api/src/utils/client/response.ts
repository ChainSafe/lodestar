import {HeadersExtra, HttpHeader, parseContentTypeHeader} from "../headers.js";
import {HttpStatusCode} from "../httpStatusCode.js";
import {Endpoint} from "../types.js";
import {WireFormat, getWireFormat} from "../wireFormat.js";
import {ApiError} from "./error.js";
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
        this._wireFormat = null;
        return this._wireFormat;
      }

      const contentType = this.headers.get(HttpHeader.ContentType);
      if (contentType === null) {
        if (this.status === HttpStatusCode.NO_CONTENT) {
          this._wireFormat = null;
          return this._wireFormat;
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
        throw Error(`Method only supports ${onlySupport.toUpperCase()} responses`);
      }

      this._wireFormat = wireFormat;
    }
    return this._wireFormat;
  }

  async rawBody(): Promise<RawBody> {
    this.assertOk();

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

  meta(): E["meta"] {
    this.assertOk();

    if (!this._meta) {
      switch (this.wireFormat()) {
        case WireFormat.json: {
          const rawBody = this.resolvedRawBody();
          const metaJson = this.definition.resp.transform
            ? this.definition.resp.transform.fromResponse(rawBody.value).meta
            : rawBody.value;
          this._meta = this.definition.resp.meta.fromJson(metaJson);
          break;
        }
        case WireFormat.ssz:
          this._meta = this.definition.resp.meta.fromHeaders(new HeadersExtra(this.headers));
          break;
      }
    }
    return this._meta;
  }

  value(): E["return"] {
    this.assertOk();

    if (!this._value) {
      const rawBody = this.resolvedRawBody();
      const meta = this.meta();
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

  ssz(): Uint8Array {
    this.assertOk();

    const rawBody = this.resolvedRawBody();
    switch (rawBody.type) {
      case WireFormat.json:
        return this.definition.resp.data.serialize(this.value(), this.meta());
      case WireFormat.ssz:
        return rawBody.value;
      default:
        return new Uint8Array();
    }
  }

  json(): Awaited<ReturnType<Response["json"]>> {
    this.assertOk();

    const rawBody = this.resolvedRawBody();
    switch (rawBody.type) {
      case WireFormat.json:
        return rawBody.value;
      case WireFormat.ssz:
        return this.definition.resp.data.toJson(this.value(), this.meta());
      default:
        return {};
    }
  }

  assertOk(): void {
    if (!this.ok) {
      throw this.error();
    }
  }

  error(): ApiError | null {
    if (this.ok) {
      return null;
    }

    return new ApiError(this.getErrorMessage(), this.status, this.definition.operationId);
  }

  async errorBody(): Promise<string> {
    if (this._errorBody === undefined) {
      this._errorBody = await this.text();
    }
    return this._errorBody;
  }

  private resolvedRawBody(): RawBody {
    if (!this._rawBody) {
      throw Error("rawBody() must be called first");
    }
    return this._rawBody;
  }

  private resolvedErrorBody(): string {
    if (this._errorBody === undefined) {
      throw Error("errorBody() must be called first");
    }

    return this._errorBody;
  }

  private getErrorMessage(): string {
    const errBody = this.resolvedErrorBody();
    try {
      const errJson = JSON.parse(errBody) as {message?: string; failures?: {message: string}[]};
      if (errJson.message) {
        if (errJson.failures) {
          return `${errJson.message}\n` + errJson.failures.map((e) => e.message).join("\n");
        }
        return errJson.message;
      } else {
        return errBody;
      }
    } catch (_e) {
      return errBody || this.statusText;
    }
  }
}
