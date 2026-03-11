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
const restAssuredCode = document.querySelector("#restassured");
const playwrightCode = document.querySelector("#playwright");
const tabs = document.querySelectorAll(".tab");

specInput.value = editorState[fileType.value];

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

function resizeEditor() {
  specInput.style.height = "auto";
  const targetHeight = Math.min(specInput.scrollHeight, getEditorMaxHeight());
  specInput.style.height = `${Math.max(420, targetHeight)}px`;
  specInput.style.overflowY = specInput.scrollHeight > getEditorMaxHeight() ? "auto" : "hidden";
}

function syncCurrentEditorState() {
  editorState[fileType.value] = specInput.value;
  resizeEditor();
}

specInput.addEventListener("input", syncCurrentEditorState);
window.addEventListener("resize", resizeEditor);

fileType.addEventListener("change", () => {
  specInput.value = editorState[fileType.value];
  resizeEditor();
  specInput.focus();
});

tabs.forEach((tab) => {
  tab.addEventListener("click", () => setActiveTab(tab.dataset.target));
});

resizeEditor();

generateButton.addEventListener("click", async () => {
  syncCurrentEditorState();
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
