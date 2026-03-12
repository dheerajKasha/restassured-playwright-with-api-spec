const fs = require("fs");
const path = require("path");
const http = require("http");
const { validateSpecContent } = require("./openapi");
const { generateFromSpec, readOutputFiles } = require("./generate");

const PORT = Number(process.env.PORT || 3001);
const UI_DIR = path.join(__dirname, "..", "ui");
const OUTPUT_ROOT = path.join(process.cwd(), ".tmp", "ui-runs");
const YAML_BUNDLE_PATH = path.join(process.cwd(), "node_modules", "js-yaml", "dist", "js-yaml.min.js");

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function sendFile(response, filePath, contentType) {
  const content = fs.readFileSync(filePath, "utf8");
  response.writeHead(200, { "Content-Type": contentType });
  response.end(content);
}

function createRunDirectory() {
  const runId = String(Date.now());
  const runDir = path.join(OUTPUT_ROOT, runId);
  fs.mkdirSync(runDir, { recursive: true });
  return runDir;
}

function collectBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });

    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function normalizeSpecText(value) {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.join("\n");
  }

  return value ? String(value) : "";
}

async function handleGenerate(request, response) {
  try {
    const rawBody = await collectBody(request);
    const payload = JSON.parse(rawBody || "{}");
    const specText = normalizeSpecText(payload.specText);
    const fileType = payload.fileType === "json" ? "json" : "yaml";
    const useLlm = Boolean(payload.useLlm);

    if (!specText.trim()) {
      sendJson(response, 400, {
        error: "Please provide an OpenAPI or Swagger spec.",
        validationErrors: [{ line: 1, column: 1, message: "The spec editor is empty." }]
      });
      return;
    }

    const extension = fileType === "json" ? ".json" : ".yaml";
    const validation = validateSpecContent(specText, extension);

    if (!validation.valid) {
      sendJson(response, 400, {
        error: "Validation failed.",
        validationErrors: validation.errors
      });
      return;
    }

    const runDir = createRunDirectory();
    const result = await generateFromSpec(validation.spec, runDir, { useLlm });
    const files = readOutputFiles(result.outputs);

    sendJson(response, 200, {
      specTitle: result.specTitle,
      operations: result.operations.length,
      testCases: result.cases.length,
      llm: result.llm,
      rawTests: files,
      scaffoldDirs: {
        restAssured: result.outputs.restAssuredProjectDir,
        playwright: result.outputs.playwrightProjectDir
      }
    });
  } catch (error) {
    sendJson(response, 400, { error: error.message });
  }
}

const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "GET" && request.url === "/") {
    sendFile(response, path.join(UI_DIR, "index.html"), "text/html; charset=utf-8");
    return;
  }

  if (request.method === "GET" && request.url === "/app.js") {
    sendFile(response, path.join(UI_DIR, "app.js"), "application/javascript; charset=utf-8");
    return;
  }

  if (request.method === "GET" && request.url === "/styles.css") {
    sendFile(response, path.join(UI_DIR, "styles.css"), "text/css; charset=utf-8");
    return;
  }

  if (request.method === "GET" && request.url === "/vendor/js-yaml.min.js") {
    sendFile(response, YAML_BUNDLE_PATH, "application/javascript; charset=utf-8");
    return;
  }

  if (request.method === "POST" && request.url === "/api/generate") {
    await handleGenerate(request, response);
    return;
  }

  sendJson(response, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`UI server running at http://127.0.0.1:${PORT}`);
});
