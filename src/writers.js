const fs = require("fs");
const path = require("path");

const REST_ASSURED_VERSION = "5.5.7";
const JUNIT_VERSION = "5.14.3";
const PLAYWRIGHT_VERSION = "1.52.0";

function escapeJavaString(value) {
  return JSON.stringify(value);
}

function toJsonLiteral(value) {
  return JSON.stringify(value);
}

function renderRequestPath(operationPath, pathParams) {
  return operationPath.replace(/{([^}]+)}/g, (_, name) => encodeURIComponent(String(pathParams[name])));
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
    lines.push(`            .contentType("application/json")`);
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

function renderRestAssuredFile(operations, cases, withPackage) {
  const tests = cases
    .map((testCase) => {
      const operation = operations.find((candidate) => candidate.operationId === testCase.operationId);
      return renderRestAssuredTest(testCase, operation);
    })
    .join("\n\n");

  const packageLine = withPackage ? "package com.generated.api;\n\n" : "";
  const setupBlock = withPackage
    ? `    @BeforeAll\n    static void configureBaseUrl() {\n        RestAssured.baseURI = System.getProperty(\n            \"baseUrl\",\n            System.getenv().getOrDefault(\"BASE_URL\", \"http://localhost:3000\")\n        );\n    }\n\n`
    : "";
  const beforeAllImport = withPackage ? "import org.junit.jupiter.api.BeforeAll;\n" : "";
  const restAssuredImport = withPackage ? "import io.restassured.RestAssured;\n" : "";

  return `${packageLine}${restAssuredImport}${beforeAllImport}import org.junit.jupiter.api.Test;\n\nimport static io.restassured.RestAssured.given;\n\npublic class GeneratedApiTest {\n\n${setupBlock}${tests}\n}\n`;
}

function renderPlaywrightOptions(request) {
  const options = [];

  if (Object.keys(request.queryParams || {}).length > 0) {
    options.push(`params: ${JSON.stringify(request.queryParams, null, 2)}`);
  }

  if (request.body) {
    options.push(`data: ${JSON.stringify(request.body, null, 2)}`);
  }

  if (options.length === 0) {
    return "";
  }

  return `, {\n      ${options.join(",\n      ")}\n    }`;
}

function renderPlaywrightRequest(testCase, operation) {
  const renderedPath = renderRequestPath(operation.path, testCase.request.pathParams || {});
  const optionBlock = renderPlaywrightOptions(testCase.request);
  return `  const response = await request.${operation.method.toLowerCase()}(${JSON.stringify(renderedPath)}${optionBlock});`;
}

function renderPlaywrightTest(testCase, operation) {
  return `test(${JSON.stringify(testCase.description)}, async ({ request }) => {\n${renderPlaywrightRequest(testCase, operation)}\n  expect(response.status()).toBe(${testCase.expectedStatus});\n});`;
}

function renderPlaywrightFile(operations, cases) {
  const tests = cases
    .map((testCase) => {
      const operation = operations.find((candidate) => candidate.operationId === testCase.operationId);
      return renderPlaywrightTest(testCase, operation);
    })
    .join("\n\n");

  return `const { test, expect } = require("@playwright/test");\n\n${tests}\n`;
}

function renderPomXml() {
  return `<project xmlns="http://maven.apache.org/POM/4.0.0"\n         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">\n    <modelVersion>4.0.0</modelVersion>\n\n    <groupId>com.generated</groupId>\n    <artifactId>generated-restassured-tests</artifactId>\n    <version>1.0.0</version>\n\n    <properties>\n        <maven.compiler.source>17</maven.compiler.source>\n        <maven.compiler.target>17</maven.compiler.target>\n        <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>\n    </properties>\n\n    <dependencies>\n        <dependency>\n            <groupId>io.rest-assured</groupId>\n            <artifactId>rest-assured</artifactId>\n            <version>${REST_ASSURED_VERSION}</version>\n            <scope>test</scope>\n        </dependency>\n        <dependency>\n            <groupId>org.junit.jupiter</groupId>\n            <artifactId>junit-jupiter</artifactId>\n            <version>${JUNIT_VERSION}</version>\n            <scope>test</scope>\n        </dependency>\n    </dependencies>\n\n    <build>\n        <plugins>\n            <plugin>\n                <groupId>org.apache.maven.plugins</groupId>\n                <artifactId>maven-surefire-plugin</artifactId>\n                <version>3.5.4</version>\n                <configuration>\n                    <useModulePath>false</useModulePath>\n                </configuration>\n            </plugin>\n        </plugins>\n    </build>\n</project>\n`;
}

function renderRestAssuredReadme(specTitle) {
  return `# Runnable REST Assured Project\n\nGenerated for ${specTitle}.\n\n## Run\n\n1. Set your API base URL:\n\n   PowerShell: \`$env:BASE_URL=\"https://api.example.com\"\`\n\n2. Execute the suite:\n\n   \`mvn test\`\n\nYou can also override the base URL with \`-DbaseUrl=https://api.example.com\`.\n`;
}

function renderPlaywrightPackageJson() {
  return JSON.stringify(
    {
      name: "generated-playwright-api-tests",
      version: "1.0.0",
      private: true,
      scripts: {
        test: "playwright test",
        "test:headed": "playwright test --headed"
      },
      devDependencies: {
        "@playwright/test": PLAYWRIGHT_VERSION
      }
    },
    null,
    2
  ) + "\n";
}

function renderPlaywrightConfig() {
  return `const { defineConfig } = require("@playwright/test");\n\nmodule.exports = defineConfig({\n  testDir: "./tests",\n  use: {\n    baseURL: process.env.BASE_URL || "http://localhost:3000"\n  },\n  reporter: [["list"]]\n});\n`;
}

function renderPlaywrightReadme(specTitle) {
  return `# Runnable Playwright API Project\n\nGenerated for ${specTitle}.\n\n## Run\n\n1. Install dependencies:\n\n   \`npm install\`\n\n2. Set your API base URL:\n\n   PowerShell: \`$env:BASE_URL=\"https://api.example.com\"\`\n\n3. Execute the suite:\n\n   \`npm test\`\n`;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, "utf8");
}

function writeOutputs({ operations, cases, outputPath, specTitle }) {
  const restAssuredDir = path.join(outputPath, "restassured");
  const playwrightDir = path.join(outputPath, "playwright");
  const restAssuredProjectDir = path.join(outputPath, "restassured-project");
  const playwrightProjectDir = path.join(outputPath, "playwright-project");

  writeFile(
    path.join(restAssuredDir, "GeneratedApiTest.java"),
    renderRestAssuredFile(operations, cases, false)
  );

  writeFile(
    path.join(playwrightDir, "generated-api.spec.js"),
    renderPlaywrightFile(operations, cases)
  );

  writeFile(path.join(restAssuredProjectDir, "pom.xml"), renderPomXml());
  writeFile(
    path.join(restAssuredProjectDir, "src", "test", "java", "com", "generated", "api", "GeneratedApiTest.java"),
    renderRestAssuredFile(operations, cases, true)
  );
  writeFile(path.join(restAssuredProjectDir, "README.md"), renderRestAssuredReadme(specTitle));

  writeFile(path.join(playwrightProjectDir, "package.json"), renderPlaywrightPackageJson());
  writeFile(path.join(playwrightProjectDir, "playwright.config.js"), renderPlaywrightConfig());
  writeFile(
    path.join(playwrightProjectDir, "tests", "generated-api.spec.js"),
    renderPlaywrightFile(operations, cases)
  );
  writeFile(path.join(playwrightProjectDir, "README.md"), renderPlaywrightReadme(specTitle));
}

module.exports = {
  writeOutputs
};
