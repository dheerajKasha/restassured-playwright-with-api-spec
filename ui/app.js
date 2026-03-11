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

const specInput = document.querySelector("#specInput");
const fileType = document.querySelector("#fileType");
const generateButton = document.querySelector("#generateButton");
const stats = document.querySelector("#stats");
const paths = document.querySelector("#paths");
const restAssuredCode = document.querySelector("#restassured");
const playwrightCode = document.querySelector("#playwright");
const tabs = document.querySelectorAll(".tab");

specInput.value = sampleSpec;

function setActiveTab(targetId) {
  tabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.target === targetId);
  });

  [restAssuredCode, playwrightCode].forEach((node) => {
    node.classList.toggle("active", node.id === targetId);
  });
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => setActiveTab(tab.dataset.target));
});

generateButton.addEventListener("click", async () => {
  stats.textContent = "Generating...";
  paths.innerHTML = "";

  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        specText: specInput.value,
        fileType: fileType.value
      })
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Generation failed.");
    }

    stats.textContent = `${payload.specTitle}: ${payload.operations} operations, ${payload.testCases} generated test cases.`;
    restAssuredCode.textContent = payload.rawTests.restAssured;
    playwrightCode.textContent = payload.rawTests.playwright;
    paths.innerHTML = `
      <div class="path-card"><strong>REST Assured project</strong><br>${payload.scaffoldDirs.restAssured}</div>
      <div class="path-card"><strong>Playwright project</strong><br>${payload.scaffoldDirs.playwright}</div>
    `;
    setActiveTab("restassured");
  } catch (error) {
    stats.textContent = error.message;
    restAssuredCode.textContent = "";
    playwrightCode.textContent = "";
  }
});
