const { resolveSchema } = require("./openapi");

function pickStatus(responses, preferred) {
  if (responses[preferred]) {
    return Number(preferred);
  }

  const match = Object.keys(responses).find((code) => /^2\d\d$/.test(code));
  return match ? Number(match) : 200;
}

function pickNegativeStatus(responses) {
  if (responses["400"]) {
    return 400;
  }

  if (responses["422"]) {
    return 422;
  }

  return 400;
}

function toPascalCase(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function makeMethodName(prefix, operationId, suffix) {
  return `${prefix}${toPascalCase(operationId)}${suffix}`;
}

function exampleValue(schema) {
  if (!schema) {
    return "sample";
  }

  if (schema.example !== undefined) {
    return schema.example;
  }

  if (schema.enum && schema.enum.length > 0) {
    return schema.enum[0];
  }

  switch (schema.type) {
    case "integer":
      return 1;
    case "number":
      return 1.5;
    case "boolean":
      return true;
    case "array":
      return [exampleValue(schema.items || {})];
    case "object":
      return buildExampleObject(schema);
    case "string":
    default:
      return "sample";
  }
}

function invalidValue(schema) {
  if (!schema) {
    return "invalid";
  }

  if (schema.enum) {
    return "invalid-enum";
  }

  switch (schema.type) {
    case "integer":
    case "number":
      return "invalid";
    case "boolean":
      return "not-boolean";
    case "array":
      return "not-an-array";
    case "string":
    default:
      return "";
  }
}

function edgeValue(schema) {
  if (!schema) {
    return "x".repeat(256);
  }

  if (schema.maxLength) {
    return "x".repeat(schema.maxLength + 1);
  }

  if (schema.type === "string") {
    return "x".repeat(256);
  }

  if (schema.type === "integer" || schema.type === "number") {
    return 999999999;
  }

  return invalidValue(schema);
}

function buildExampleObject(schema) {
  const properties = schema.properties || {};
  const result = {};

  Object.entries(properties).forEach(([key, propertySchema]) => {
    result[key] = exampleValue(propertySchema);
  });

  return result;
}

function buildValidRequest(operation, spec) {
  const pathParams = {};
  const queryParams = {};

  operation.parameters.forEach((parameter) => {
    const schema = resolveSchema(parameter.schema, spec) || {};
    const value = exampleValue(schema);

    if (parameter.in === "path") {
      pathParams[parameter.name] = value;
    } else if (parameter.in === "query") {
      queryParams[parameter.name] = value;
    }
  });

  const body = operation.requestBody ? buildExampleObject(operation.requestBody.schema || {}) : null;

  return { pathParams, queryParams, body };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildTestCases(operation, spec) {
  const cases = [];
  const baseRequest = buildValidRequest(operation, spec);
  const successStatus = pickStatus(operation.responses, "200");
  const negativeStatus = pickNegativeStatus(operation.responses);

  cases.push({
    source: "heuristic",
    operationId: operation.operationId,
    name: makeMethodName("should", operation.operationId, "ReturnSuccessForValidRequest"),
    description: `${operation.method} ${operation.path} returns success for a valid request`,
    expectedStatus: successStatus,
    request: baseRequest
  });

  operation.parameters.forEach((parameter) => {
    const schema = resolveSchema(parameter.schema, spec) || {};
    const parameterName = toPascalCase(parameter.name);

    if (parameter.required) {
      const invalidRequest = clone(baseRequest);

      if (parameter.in === "path") {
        invalidRequest.pathParams[parameter.name] = invalidValue(schema);
      } else if (parameter.in === "query") {
        delete invalidRequest.queryParams[parameter.name];
      }

      cases.push({
        source: "heuristic",
        operationId: operation.operationId,
        name: makeMethodName("should", operation.operationId, `Return${negativeStatus}ForInvalid${parameterName}`),
        description: `${operation.method} ${operation.path} rejects invalid ${parameter.name}`,
        expectedStatus: negativeStatus,
        request: invalidRequest
      });
    }

    if (schema.enum || schema.type === "string" || schema.type === "integer") {
      const edgeRequest = clone(baseRequest);

      if (parameter.in === "path") {
        edgeRequest.pathParams[parameter.name] = edgeValue(schema);
      } else if (parameter.in === "query") {
        edgeRequest.queryParams[parameter.name] = edgeValue(schema);
      }

      cases.push({
        source: "heuristic",
        operationId: operation.operationId,
        name: makeMethodName("should", operation.operationId, `HandleEdgeCaseFor${parameterName}`),
        description: `${operation.method} ${operation.path} covers edge conditions for ${parameter.name}`,
        expectedStatus: negativeStatus,
        request: edgeRequest
      });
    }
  });

  if (operation.requestBody && operation.requestBody.required) {
    const requiredFields = operation.requestBody.schema.required || [];
    if (requiredFields.length > 0) {
      const body = clone(baseRequest.body || {});
      delete body[requiredFields[0]];

      cases.push({
        source: "heuristic",
        operationId: operation.operationId,
        name: makeMethodName("should", operation.operationId, `Return${negativeStatus}ForMissingRequiredBodyField`),
        description: `${operation.method} ${operation.path} rejects body without ${requiredFields[0]}`,
        expectedStatus: negativeStatus,
        request: { ...baseRequest, body }
      });
    }
  }

  return cases;
}

module.exports = {
  buildTestCases,
  toPascalCase,
  makeMethodName
};
