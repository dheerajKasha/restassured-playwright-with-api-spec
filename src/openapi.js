const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"];
const HTTP_METHOD_SET = new Set(HTTP_METHODS);

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

function findLiteralLine(content, literal, fallbackLine = 1) {
  const lines = content.split(/\r?\n/);
  const index = lines.findIndex((line) => line.includes(literal));
  return index >= 0 ? index + 1 : fallbackLine;
}

function findSchemaPathLine(content, segments, fallbackLine = 1) {
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (typeof segment !== "string" || !segment) {
      continue;
    }

    const line = findLiteralLine(content, `${segment}:`, fallbackLine);
    if (line !== fallbackLine || index === segments.length - 1) {
      return line;
    }
  }

  return fallbackLine;
}

function schemaHasShape(schema) {
  return Boolean(
    schema.type ||
      schema.properties ||
      schema.items ||
      schema.allOf ||
      schema.oneOf ||
      schema.anyOf ||
      schema.enum ||
      schema.additionalProperties
  );
}

function validateSchemaNode(schema, content, pathSegments, fallbackLine = 1) {
  const line = findSchemaPathLine(content, pathSegments, fallbackLine);
  const label = pathSegments.join(".");

  if (schema === null || schema === undefined) {
    return [buildValidationError(`Schema '${label}' is missing a type or nested schema definition.`, line, 1)];
  }

  if (typeof schema !== "object" || Array.isArray(schema)) {
    return [buildValidationError(`Schema '${label}' must be an object.`, line, 1)];
  }

  if (schema.$ref) {
    return [];
  }

  const errors = [];

  if (!schemaHasShape(schema)) {
    errors.push(buildValidationError(`Schema '${label}' is missing a type or nested schema definition.`, line, 1));
    return errors;
  }

  if (schema.type === "array" && !schema.items) {
    errors.push(buildValidationError(`Array schema '${label}' must define 'items'.`, line, 1));
  }

  if (schema.items) {
    errors.push(...validateSchemaNode(schema.items, content, [...pathSegments, "items"], line));
  }

  if (schema.properties && typeof schema.properties === "object") {
    Object.entries(schema.properties).forEach(([propertyName, propertySchema]) => {
      errors.push(...validateSchemaNode(propertySchema, content, [...pathSegments, propertyName], line));
    });
  }

  ["allOf", "oneOf", "anyOf"].forEach((keyword) => {
    if (Array.isArray(schema[keyword])) {
      schema[keyword].forEach((childSchema, index) => {
        errors.push(...validateSchemaNode(childSchema, content, [...pathSegments, `${keyword}[${index}]`], line));
      });
    }
  });

  if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
    errors.push(...validateSchemaNode(schema.additionalProperties, content, [...pathSegments, "additionalProperties"], line));
  }

  return errors;
}

function collectSchemaValidationErrors(spec, content) {
  const errors = [];

  if (spec.definitions && typeof spec.definitions === "object") {
    Object.entries(spec.definitions).forEach(([name, schema]) => {
      errors.push(...validateSchemaNode(schema, content, ["definitions", name], findKeyLine(content, "definitions")));
    });
  }

  if (spec.components && spec.components.schemas && typeof spec.components.schemas === "object") {
    Object.entries(spec.components.schemas).forEach(([name, schema]) => {
      errors.push(...validateSchemaNode(schema, content, ["components", "schemas", name], findKeyLine(content, "schemas")));
    });
  }

  if (spec.paths && typeof spec.paths === "object") {
    Object.entries(spec.paths).forEach(([pathName, pathItem]) => {
      if (!pathItem || typeof pathItem !== "object") {
        return;
      }

      Object.entries(pathItem).forEach(([method, operation]) => {
        if (!HTTP_METHOD_SET.has(method) || !operation || typeof operation !== "object") {
          return;
        }

        const operationLine = findLiteralLine(content, `${method}:`, findLiteralLine(content, pathName, 1));

        (operation.parameters || []).forEach((parameter, index) => {
          if (!parameter || typeof parameter !== "object" || parameter.$ref) {
            return;
          }

          if (parameter.schema && typeof parameter.schema === "object") {
            errors.push(
              ...validateSchemaNode(
                parameter.schema,
                content,
                [pathName, method, "parameters", parameter.name || String(index + 1)],
                operationLine
              )
            );
          }
        });

        if (operation.requestBody && operation.requestBody.content) {
          Object.entries(operation.requestBody.content).forEach(([mediaType, media]) => {
            if (media && media.schema) {
              errors.push(...validateSchemaNode(media.schema, content, [pathName, method, "requestBody", mediaType], operationLine));
            }
          });
        }

        if (operation.responses && typeof operation.responses === "object") {
          Object.entries(operation.responses).forEach(([statusCode, response]) => {
            if (!response || typeof response !== "object") {
              return;
            }

            if (response.schema) {
              errors.push(...validateSchemaNode(response.schema, content, [pathName, method, "responses", statusCode], operationLine));
            }

            if (response.content && typeof response.content === "object") {
              Object.entries(response.content).forEach(([mediaType, media]) => {
                if (media && media.schema) {
                  errors.push(...validateSchemaNode(media.schema, content, [pathName, method, "responses", statusCode, mediaType], operationLine));
                }
              });
            }
          });
        }
      });
    });
  }

  return errors;
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
    const schemaErrors = shapeErrors.length === 0 ? collectSchemaValidationErrors(spec, content) : [];
    const errors = [...shapeErrors, ...schemaErrors];

    if (errors.length > 0) {
      return {
        valid: false,
        errors
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
