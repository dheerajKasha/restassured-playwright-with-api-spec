const fs = require("fs");
const path = require("path");

function escapeJavaString(value) {
  return JSON.stringify(value);
}

function toJsonLiteral(value) {
  return JSON.stringify(value);
}

function renderJavaGiven(request) {
  const lines = ["        given()"];

  Object.entries(request.pathParams || {}).forEach(([key, value]) => {
    lines.push(`            .pathParam(${escapeJavaString(key)}, ${escapeJavaString(String(value))})`);
  });

  Object.entries(request.queryParams || {}).forEach(([key, value]) => {
    lines.push(`            .queryParam(${escapeJavaString(key)}, ${escapeJavaString(String(value))})`);
  });

  if (request.body) {
    lines.push(`            .body(${escapeJavaString(toJsonLiteral(request.body))})`);
  }

  return lines.join("\n");
}

function renderRestAssuredTest(testCase, operation) {
  return `    @Test
    void ${testCase.name}() {
${renderJavaGiven(testCase.request)}
        .when()
            .request(${escapeJavaString(operation.method)}, ${escapeJavaString(operation.path)})
        .then()
            .statusCode(${testCase.expectedStatus});
    }`;
}

function renderRestAssuredFile(operations, cases) {
  const tests = cases
    .map((testCase) => {
      const operation = operations.find((candidate) => candidate.operationId === testCase.operationId);
      return renderRestAssuredTest(testCase, operation);
    })
    .join("\n\n");

  return `import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;

public class GeneratedApiTest {

${tests}
}
`;
}

function renderPlaywrightRequest(testCase, operation) {
  const renderedPath = operation.path.replace(/{([^}]+)}/g, (_, name) => {
    const value = testCase.request.pathParams[name];
    return `\${${JSON.stringify(String(value))}}`;
  });

  const options = [];

  if (Object.keys(testCase.request.queryParams || {}).length > 0) {
    options.push(`params: ${JSON.stringify(testCase.request.queryParams, null, 2)}`);
  }

  if (testCase.request.body) {
    options.push(`data: ${JSON.stringify(testCase.request.body, null, 2)}`);
  }

  const optionBlock = options.length > 0 ? `, {\n      ${options.join(",\n      ")}\n    }` : "";

  return `  const response = await request.${operation.method.toLowerCase()}(\`${renderedPath}\`${optionBlock});`;
}

function renderPlaywrightTest(testCase, operation) {
  return `test(${JSON.stringify(testCase.description)}, async ({ request }) => {
${renderPlaywrightRequest(testCase, operation)}
  expect(response.status()).toBe(${testCase.expectedStatus});
});`;
}

function renderPlaywrightFile(operations, cases) {
  const tests = cases
    .map((testCase) => {
      const operation = operations.find((candidate) => candidate.operationId === testCase.operationId);
      return renderPlaywrightTest(testCase, operation);
    })
    .join("\n\n");

  return `const { test, expect } = require("@playwright/test");

${tests}
`;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeOutputs({ operations, cases, outputPath }) {
  const restAssuredDir = path.join(outputPath, "restassured");
  const playwrightDir = path.join(outputPath, "playwright");

  ensureDir(restAssuredDir);
  ensureDir(playwrightDir);

  fs.writeFileSync(
    path.join(restAssuredDir, "GeneratedApiTest.java"),
    renderRestAssuredFile(operations, cases),
    "utf8"
  );

  fs.writeFileSync(
    path.join(playwrightDir, "generated-api.spec.js"),
    renderPlaywrightFile(operations, cases),
    "utf8"
  );
}

module.exports = {
  writeOutputs
};
