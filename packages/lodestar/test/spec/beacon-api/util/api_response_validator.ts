import {OpenAPIV3, OpenAPIV3_1} from "openapi-types";
import Ajv, {ErrorObject} from "ajv";

export type Spec = OpenAPIV3.Document | OpenAPIV3_1.Document;

// TODOs:
// Can the response object be all typed as {data: Record}?
// Can the spec object be typed as OpenAPIV3?
// Delete properties and confirm validation fails

type TestParams = {
  path: string;
  method: "get" | "post" | "put";
  status: number;
};

type ValidatorResponse = {
  isValid: boolean;
  errors?: ErrorObject[] | null | undefined;
};

export const isValidResponse = (
  response: Record<string, unknown>,
  spec: Record<string, any>,
  params: TestParams
): ValidatorResponse => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const schema =
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-unsafe-assignment
    spec["paths"][params.path][params.method]["responses"][params.status]["content"]["application/json"]["schema"];

  const ajv = new Ajv({
    strict: false,
  });

  const validate = ajv.compile(schema);
  const isValid = validate(response);
  if (isValid) {
    return {isValid};
  } else {
    console.log(validate.errors);
    return {isValid, errors: validate.errors};
  }
};
