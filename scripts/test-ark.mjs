import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = dirname(scriptDir);
const source = await readFile(join(root, ".env"), "utf8");
const env = {};

for (const rawLine of source.split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line || line.startsWith("#")) continue;
  const separator = line.indexOf("=");
  if (separator < 1) continue;
  const key = line.slice(0, separator).trim();
  let value = line.slice(separator + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  env[key] = value;
}

if (!env.ARK_API_KEY) throw new Error(".env 中没有 ARK_API_KEY");

const baseUrl = env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3";
const apiPath = env.ARK_API_PATH || "/responses";
const model = env.ARK_VISION_MODEL || "doubao-seed-evolving";
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 90_000);

try {
  const response = await fetch(`${baseUrl}${apiPath}`, {
    method: "POST",
    signal: controller.signal,
    headers: {
      Authorization: `Bearer ${env.ARK_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: [{
        role: "user",
        content: [
          { type: "input_image", image_url: "https://ark-project.tos-cn-beijing.volces.com/doc_image/ark_demo_img_1.png" },
          { type: "input_text", text: "请用不超过20个中文字符说明图片主体。" }
        ]
      }],
      thinking: { type: "disabled" },
      max_output_tokens: 600
    })
  });

  const payload = await response.json().catch(() => ({}));
  const reply = (payload.output || [])
    .flatMap((item) => item.content || [])
    .filter((item) => item.type === "output_text")
    .map((item) => item.text || "")
    .join("");

  console.log(JSON.stringify({
    httpStatus: response.status,
    ok: response.ok,
    model,
    status: payload.status || null,
    incompleteReason: payload.incomplete_details?.reason || null,
    reply: reply.slice(0, 120),
    error: payload.error?.message || null
  }, null, 2));

  if (!response.ok) process.exitCode = 1;
} finally {
  clearTimeout(timeout);
}
