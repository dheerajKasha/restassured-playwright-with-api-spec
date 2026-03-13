const sampleSpec = `openapi: 3.0.3
info:
  title: User API
  version: 1.0.0
paths:
  /users/{id}:
    get:
      operationId: getUserById
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      responses:
        "200":
          description: OK
        "400":
          description: Invalid request
`;

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete"]);

const editorState = {
  yaml: sampleSpec,
  json: ""
};

const specInput = document.querySelector("#specInput");
const fileType = document.querySelector("#fileType");
const useLlm = document.querySelector("#useLlm");
const generateButton = document.querySelector("#generateButton");
const stats = document.querySelector("#stats");
const llmStatus = document.querySelector("#llmStatus");
const paths = document.querySelector("#paths");
const validationPanel = document.querySelector("#validationPanel");
const validationList = document.querySelector("#validationList");
const lineNumbers = document.querySelector("#lineNumbers");
const lineNumbersContent = document.querySelector("#lineNumbersContent");
const llmInfoTrigger = document.querySelector("#llmInfoTrigger");
const llmTooltip = document.querySelector("#llmTooltip");
const restAssuredCode = document.querySelector("#restassured");
const playwrightCode = document.querySelector("#playwright");
const tabs = document.querySelectorAll(".tab");

specInput.value = editorState[fileType.value];

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
    return [{ message: `Schema '${label}' is missing a type or nested schema definition.`, line, column: 1 }];
  }

  if (typeof schema !== "object" || Array.isArray(schema)) {
    return [{ message: `Schema '${label}' must be an object.`, line, column: 1 }];
  }

  if (schema.$ref) {
    return [];
  }

  const errors = [];

  if (!schemaHasShape(schema)) {
    errors.push({ message: `Schema '${label}' is missing a type or nested schema definition.`, line, column: 1 });
    return errors;
  }

  if (schema.type === "array" && !schema.items) {
    errors.push({ message: `Array schema '${label}' must define 'items'.`, line, column: 1 });
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
        if (!HTTP_METHODS.has(method) || !operation || typeof operation !== "object") {
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
    errors.push({ message: "The pasted content must parse into an OpenAPI or Swagger object.", line: 1, column: 1 });
    return errors;
  }

  if (!spec.openapi && !spec.swagger) {
    errors.push({
      message: "Missing required top-level 'openapi' or 'swagger' field.",
      line: findKeyLine(content, "openapi"),
      column: 1
    });
  }

  if (!spec.paths || typeof spec.paths !== "object") {
    errors.push({
      message: "Missing required top-level 'paths' object.",
      line: findKeyLine(content, "paths"),
      column: 1
    });
  }

  return errors;
}

function validateCurrentSpec() {
  const currentValue = editorState[fileType.value];

  if (!currentValue.trim()) {
    return {
      valid: false,
      errors: [{ line: 1, column: 1, message: "Please provide an OpenAPI or Swagger spec." }]
    };
  }

  try {
    const parsed = fileType.value === "yaml"
      ? window.jsyaml.load(currentValue)
      : JSON.parse(currentValue);
    const shapeErrors = validateSpecShape(parsed, currentValue);
    const schemaErrors = shapeErrors.length === 0 ? collectSchemaValidationErrors(parsed, currentValue) : [];
    const errors = [...shapeErrors, ...schemaErrors];

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    return { valid: true, errors: [] };
  } catch (error) {
    if (fileType.value === "yaml") {
      return {
        valid: false,
        errors: [{
          line: error.mark ? error.mark.line + 1 : 1,
          column: error.mark ? error.mark.column + 1 : 1,
          message: error.reason || error.message
        }]
      };
    }

    const location = getJsonParseLocation(currentValue, error.message || "Invalid JSON.");
    return {
      valid: false,
      errors: [{ line: location.line, column: location.column, message: error.message || "Invalid JSON." }]
    };
  }
}

function setEditorMetrics() {
  const computed = window.getComputedStyle(specInput);
  document.documentElement.style.setProperty("--editor-font-size", computed.fontSize);
  document.documentElement.style.setProperty("--editor-line-height", computed.lineHeight === "normal" ? "24px" : computed.lineHeight);
}

function setActiveTab(targetId) {
  tabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.target === targetId);
  });

  [restAssuredCode, playwrightCode].forEach((node) => {
    node.classList.toggle("active", node.id === targetId);
  });
}

function getEditorMaxHeight() {
  const viewportRatio = window.innerWidth < 960 ? 0.56 : 0.72;
  return Math.max(420, Math.floor(window.innerHeight * viewportRatio));
}

function syncLineNumberScroll() {
  lineNumbersContent.style.transform = `translateY(${-specInput.scrollTop}px)`;
}

function updateLineNumbers() {
  const lineCount = Math.max(1, specInput.value.split(/\r?\n/).length);
  lineNumbersContent.innerHTML = Array.from({ length: lineCount }, (_, index) => `<div class="line-number">${index + 1}</div>`).join("");
  lineNumbers.style.height = `${specInput.clientHeight}px`;
  syncLineNumberScroll();
}

function resizeEditor() {
  setEditorMetrics();
  specInput.style.height = "auto";
  const targetHeight = Math.min(specInput.scrollHeight, getEditorMaxHeight());
  specInput.style.height = `${Math.max(420, targetHeight)}px`;
  specInput.style.overflowY = specInput.scrollHeight > getEditorMaxHeight() ? "auto" : "hidden";
  updateLineNumbers();
}

function clearValidationErrors() {
  validationPanel.classList.add("hidden");
  validationList.innerHTML = "";
}

function renderValidationErrors(errors) {
  if (!errors || errors.length === 0) {
    clearValidationErrors();
    return;
  }

  validationPanel.classList.remove("hidden");
  validationList.innerHTML = errors
    .map(
      (error) => `
        <article class="validation-item">
          <div class="validation-line">Line ${error.line}, column ${error.column}</div>
          <div>${error.message}</div>
        </article>
      `
    )
    .join("");
}

function applyValidationState() {
  const validation = validateCurrentSpec();

  if (validation.valid) {
    clearValidationErrors();
    stats.textContent = "OpenAPI or Swagger spec looks valid.";
    generateButton.disabled = false;
  } else {
    renderValidationErrors(validation.errors);
    stats.textContent = `Fix ${validation.errors.length} validation issue${validation.errors.length === 1 ? "" : "s"} before generating tests.`;
    generateButton.disabled = true;
  }

  return validation;
}

function syncCurrentEditorState() {
  editorState[fileType.value] = specInput.value;
  resizeEditor();
  applyValidationState();
}

function toggleTooltip(forceVisible) {
  llmTooltip.classList.toggle("visible", forceVisible);
}

specInput.addEventListener("input", syncCurrentEditorState);
specInput.addEventListener("scroll", syncLineNumberScroll);
window.addEventListener("resize", resizeEditor);

fileType.addEventListener("change", () => {
  specInput.value = editorState[fileType.value];
  resizeEditor();
  applyValidationState();
  specInput.focus();
});

llmInfoTrigger.addEventListener("mouseenter", () => toggleTooltip(true));
llmInfoTrigger.addEventListener("mouseleave", () => toggleTooltip(false));
llmInfoTrigger.addEventListener("focus", () => toggleTooltip(true));
llmInfoTrigger.addEventListener("blur", () => toggleTooltip(false));
llmInfoTrigger.addEventListener("click", () => {
  const isVisible = llmTooltip.classList.contains("visible");
  toggleTooltip(!isVisible);
});

tabs.forEach((tab) => {
  tab.addEventListener("click", () => setActiveTab(tab.dataset.target));
});

resizeEditor();
applyValidationState();

generateButton.addEventListener("click", async () => {
  syncCurrentEditorState();
  const validation = validateCurrentSpec();

  if (!validation.valid) {
    renderValidationErrors(validation.errors);
    stats.textContent = `Fix ${validation.errors.length} validation issue${validation.errors.length === 1 ? "" : "s"} before generating tests.`;
    return;
  }

  stats.textContent = "Generating...";
  llmStatus.textContent = useLlm.checked ? "LLM mode requested." : "LLM mode is off.";
  paths.innerHTML = "";

  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        specText: editorState[fileType.value],
        fileType: fileType.value,
        useLlm: useLlm.checked
      })
    });

    const payload = await response.json();

    if (!response.ok) {
      renderValidationErrors(payload.validationErrors || []);
      throw new Error(payload.error || "Generation failed.");
    }

    stats.textContent = `${payload.specTitle}: ${payload.operations} operations, ${payload.testCases} generated test cases.`;
    llmStatus.textContent = `LLM: ${payload.llm.reason}${payload.llm.used ? `, added ${payload.llm.cases.length} cases.` : "."}`;
    restAssuredCode.textContent = payload.rawTests.restAssured;
    playwrightCode.textContent = payload.rawTests.playwright;
    paths.innerHTML = `
      <div class="path-card"><strong>REST Assured project</strong><br>${payload.scaffoldDirs.restAssured}</div>
      <div class="path-card"><strong>Playwright project</strong><br>${payload.scaffoldDirs.playwright}</div>
    `;
    setActiveTab("restassured");
  } catch (error) {
    stats.textContent = error.message;
    llmStatus.textContent = "LLM status unavailable.";
    restAssuredCode.textContent = "";
    playwrightCode.textContent = "";
  }
});
