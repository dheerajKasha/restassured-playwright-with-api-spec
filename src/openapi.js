const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"];

function buildValidationError(message, line, column) {
  return {
    message,
    line: line || 1,
    column: column || 1
  };
}

function getLineAndColumnFromOffset(content, offset) {
  const safeOffset = Math.max(0, Number(offset) || 0);
  const lines = content.slice(0, safeOffset).split(/\r?\n/);
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1
  };
}

function getJsonParseLocation(content, message) {
  const positionMatch = message.match(/position\s+(\d+)/i);
  if (!positionMatch) {
    return { line: 1, column: 1 };
  }

  return getLineAndColumnFromOffset(content, Number(positionMatch[1]));
}

function findKeyLine(content, key) {
  const lines = content.split(/\r?\n/);
  const pattern = new RegExp(`(^|["'\\s])${key}(["'\\s:]|$)`);
  const index = lines.findIndex((line) => pattern.test(line));
  return index >= 0 ? index + 1 : 1;
}

function validateSpecShape(spec, content) {
  const errors = [];

  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    errors.push(buildValidationError("The pasted content must parse into an OpenAPI or Swagger object.", 1, 1));
    return errors;
  }

  if (!spec.openapi && !spec.swagger) {
    errors.push(buildValidationError("Missing required top-level 'openapi' or 'swagger' field.", findKeyLine(content, "openapi"), 1));
  }

  if (!spec.paths || typeof spec.paths !== "object") {
    errors.push(buildValidationError("Missing required top-level 'paths' object.", findKeyLine(content, "paths"), 1));
  }

  return errors;
}

function parseSpecContent(content, extension) {
  if (extension === ".yaml" || extension === ".yml") {
    return yaml.load(content);
  }

  return JSON.parse(content);
}

function validateSpecContent(content, extension) {
  try {
    const spec = parseSpecContent(content, extension);
    const shapeErrors = validateSpecShape(spec, content);

    if (shapeErrors.length > 0) {
      return {
        valid: false,
        errors: shapeErrors
      };
    }

    return {
      valid: true,
      spec,
      errors: []
    };
  } catch (error) {
    if (extension === ".yaml" || extension === ".yml") {
      return {
        valid: false,
        errors: [
          buildValidationError(
            error.reason || error.message,
            error.mark ? error.mark.line + 1 : 1,
            error.mark ? error.mark.column + 1 : 1
          )
        ]
      };
    }

    const location = getJsonParseLocation(content, error.message || "Invalid JSON.");
    return {
      valid: false,
      errors: [buildValidationError(error.message || "Invalid JSON.", location.line, location.column)]
    };
  }
}

function loadSpec(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const extension = path.extname(filePath).toLowerCase();
  const validation = validateSpecContent(content, extension);

  if (!validation.valid) {
    const firstError = validation.errors[0];
    throw new Error(`Line ${firstError.line}, column ${firstError.column}: ${firstError.message}`);
  }

  return validation.spec;
}

function resolveSchema(schemaOrRef, spec) {
  if (!schemaOrRef) {
    return null;
  }

  if (schemaOrRef.$ref) {
    const refPath = schemaOrRef.$ref.replace(/^#\//, "").split("/");
    return refPath.reduce((node, key) => node && node[key], spec);
  }

  return schemaOrRef;
}

function normalizeParameter(parameterOrRef, spec) {
  return resolveSchema(parameterOrRef, spec);
}

function collectRequestBody(operation, spec) {
  const requestBody = resolveSchema(operation.requestBody, spec);
  if (!requestBody || !requestBody.content) {
    return null;
  }

  const jsonBody = requestBody.content["application/json"];
  if (!jsonBody) {
    return null;
  }

  return {
    required: Boolean(requestBody.required),
    schema: resolveSchema(jsonBody.schema, spec)
  };
}

function buildOperation(pathName, method, operation, spec, pathParameters) {
  const ownParameters = (operation.parameters || []).map((parameter) =>
    normalizeParameter(parameter, spec)
  );
  const parameters = [...pathParameters, ...ownParameters];
  const requestBody = collectRequestBody(operation, spec);

  return {
    method: method.toUpperCase(),
    path: pathName,
    operationId: operation.operationId || `${method}_${pathName.replace(/[{}\/-]+/g, "_")}`,
    summary: operation.summary || "",
    parameters,
    requestBody,
    responses: operation.responses || {}
  };
}

function collectOperations(spec) {
  const paths = spec.paths || {};

  return Object.entries(paths).flatMap(([pathName, pathItem]) => {
    const pathParameters = (pathItem.parameters || []).map((parameter) =>
      normalizeParameter(parameter, spec)
    );

    return HTTP_METHODS.filter((method) => pathItem[method]).map((method) =>
      buildOperation(pathName, method, pathItem[method], spec, pathParameters)
    );
  });
}

module.exports = {
  parseSpecContent,
  validateSpecContent,
  loadSpec,
  collectOperations,
  resolveSchema
};
