const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"];

function loadSpec(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const extension = path.extname(filePath).toLowerCase();

  if (extension === ".yaml" || extension === ".yml") {
    return yaml.load(content);
  }

  return JSON.parse(content);
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
  loadSpec,
  collectOperations,
  resolveSchema
};
