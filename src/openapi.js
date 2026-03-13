const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"];
const HTTP_METHOD_SET = new Set(HTTP_METHODS);
const SWAGGER2_PARAMETER_TYPES = new Set(["path", "query", "header", "formData"]);

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

function findOperationLine(content, pathName, method) {
  const lines = content.split(/\r?\n/);
  const pathIndex = lines.findIndex((line) => line.includes(pathName));

  if (pathIndex < 0) {
    return 1;
  }

  for (let index = pathIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\S/.test(line)) {
      break;
    }

    if (line.trim().startsWith(`${method}:`)) {
      return index + 1;
    }
  }

  return pathIndex + 1;
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

        const operationLine = findOperationLine(content, pathName, method);

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

function parameterNeedsSchema(spec, parameter) {
  if (!parameter || typeof parameter !== "object" || parameter.$ref) {
    return false;
  }

  if (spec.swagger === "2.0") {
    return parameter.in === "body" ? !parameter.schema : !parameter.type;
  }

  return !parameter.schema;
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

  if (!spec.info || typeof spec.info !== "object" || Array.isArray(spec.info)) {
    errors.push(buildValidationError("Missing required top-level 'info' object.", findKeyLine(content, "info"), 1));
  } else {
    if (!spec.info.title) {
      errors.push(buildValidationError("Missing required 'info.title' field.", findKeyLine(content, "title"), 1));
    }

    if (!spec.info.version) {
      errors.push(buildValidationError("Missing required 'info.version' field.", findKeyLine(content, "version"), 1));
    }
  }

  if (!spec.paths || typeof spec.paths !== "object" || Array.isArray(spec.paths)) {
    errors.push(buildValidationError("Missing required top-level 'paths' object.", findKeyLine(content, "paths"), 1));
    return errors;
  }

  const operationIds = new Map();

  Object.entries(spec.paths).forEach(([pathName, pathItem]) => {
    const pathLine = findLiteralLine(content, pathName, findKeyLine(content, "paths"));

    if (!pathItem || typeof pathItem !== "object" || Array.isArray(pathItem)) {
      errors.push(buildValidationError(`Path '${pathName}' must map to an object.`, pathLine, 1));
      return;
    }

    const methods = Object.keys(pathItem).filter((key) => HTTP_METHOD_SET.has(key));

    if (methods.length === 0) {
      errors.push(buildValidationError(`Path '${pathName}' must define at least one HTTP operation.`, pathLine, 1));
      return;
    }

    methods.forEach((method) => {
      const operation = pathItem[method];
      const operationLine = findOperationLine(content, pathName, method);

      if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
        errors.push(buildValidationError(`Operation '${method.toUpperCase()} ${pathName}' must be an object.`, operationLine, 1));
        return;
      }

      if (!operation.responses || typeof operation.responses !== "object" || Object.keys(operation.responses).length === 0) {
        errors.push(buildValidationError(`Operation '${method.toUpperCase()} ${pathName}' must define at least one response.`, operationLine, 1));
      }

      if (operation.operationId) {
        if (!operationIds.has(operation.operationId)) {
          operationIds.set(operation.operationId, []);
        }

        operationIds.get(operation.operationId).push(operationLine);
      }

      (operation.parameters || []).forEach((parameter, index) => {
        if (parameterNeedsSchema(spec, parameter)) {
          const parameterName = parameter.name || index + 1;
          const schemaMessage = spec.swagger === "2.0" && parameter.in !== "body"
            ? `Parameter '${parameterName}' in '${method.toUpperCase()} ${pathName}' is missing a type.`
            : `Parameter '${parameterName}' in '${method.toUpperCase()} ${pathName}' is missing a schema.`;
          errors.push(buildValidationError(schemaMessage, operationLine, 1));
        }
      });
    });
  });

  operationIds.forEach((lines, operationId) => {
    if (lines.length > 1) {
      lines.forEach((line) => {
        errors.push(buildValidationError(`Duplicate operationId '${operationId}' found.`, line, 1));
      });
    }
  });

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
