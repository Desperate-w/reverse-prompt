import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
await loadLocalEnv();
const PORT = Number(process.env.PORT || 4173);
const MAX_BODY_BYTES = 18 * 1024 * 1024;
const API_BASE = process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3";
const MODEL = process.env.ARK_VISION_MODEL || "doubao-seed-evolving";
const API_PATH = process.env.ARK_API_PATH || "/responses";
const requestLog = new Map();

const OBSERVER_SYSTEM = `你是“逆像”的视觉观察与艺术指导 Agent。你的职责是像资深摄影指导、平面设计师和视觉研究员一样分析图片，但所有判断必须有画面证据。
规则：
1. 你只会收到一张待识别图片。它可能是完整画面，也可能是用户框选后裁剪出的目标区域；严格限定在这张输入图片内分析，不推测裁剪区域之外的内容。
2. 严格区分可见事实与专业推断；无法确定时使用 unknown，禁止猜测真人身份、摄影师、艺术家、品牌、地点和精确镜头型号。
3. 不要因为常见审美套路而补充图片中不存在的雾、颗粒、光晕或电影感。
4. 从主体、场景、空间层次、视觉层级、构图、光线、色彩、镜头语言、材质、情绪十个维度分析。
5. 每个专业判断提供简短 evidence 和 0~1 confidence。
6. 只输出有效 JSON，不要 Markdown。`;

const CRITIC_SYSTEM = `你是视觉证据审查 Agent。重新查看当前待识别图片，审查候选分析是否忠实、完整、专业。
重点检查：主体数量与关系、框选区域、构图术语是否滥用、光向与光质、颜色、景别、视角、材质，以及任何图片中没有证据的臆测。
输出修订后的 final_analysis，同时列出 removed_claims、added_details、uncertainties。没有证据的内容必须删除，不要为了丰富而编造。只输出有效 JSON。`;

const COMPOSER_SYSTEM = `你是专业图像提示词编辑。根据已经通过视觉证据审查的分析，写一段不依赖任何特定绘图平台的通用提示词。
顺序：主体与动作 → 主体关系 → 环境 → 构图与景别 → 视角 → 光线 → 色彩 → 材质 → 有证据的情绪。
要求：
- 只使用 final_analysis 中有证据的信息，不添加模型参数、质量套话、艺术家姓名或负面提示词。
- 简洁档保留主体/环境/构图/光色；平衡档增加空间/材质/情绪；电影级档增加更精确但有依据的镜头语言和视觉层级。
- 中文自然准确，英文使用自然摄影与设计术语；不要堆砌重复形容词。
- fingerprint 返回 3~6 个短标签。
- 只输出 JSON：{"prompt":"...","fingerprint":["..."],"confidence":0.0}`;

async function loadLocalEnv() {
  try {
    const source = await readFile(join(ROOT, ".env"), "utf8");
    for (const rawLine of source.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const separator = line.indexOf("=");
      if (separator < 1) continue;
      const key = line.slice(0, separator).trim();
      let value = line.slice(separator + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      if (!process.env[key]) process.env[key] = value;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function jsonResponse(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
  });
  response.end(JSON.stringify(body));
}

function isRateLimited(ip) {
  const now = Date.now();
  const recent = (requestLog.get(ip) || []).filter((time) => now - time < 60_000);
  recent.push(now);
  requestLog.set(ip, recent);
  return recent.length > 8;
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("图片数据过大，请上传 10MB 以内的图片"), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("请求数据格式不正确"), { status: 400 }); }
}

function validateAnalyzeInput(body) {
  const allowedImage = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
  if (!['subject', 'full'].includes(body.mode)) body.mode = 'subject';
  const selectedImage = body.mode === 'full' ? body.fullImage : body.subjectImage;
  if (!allowedImage.test(selectedImage || "")) throw Object.assign(new Error("图片格式不受支持"), { status: 400 });
  if (!['zh', 'en'].includes(body.language)) body.language = 'zh';
  if (!['concise', 'balanced', 'cinematic'].includes(body.detail)) body.detail = 'balanced';
  if (!body.roi || [body.roi.x, body.roi.y, body.roi.width, body.roi.height].some((value) => typeof value !== "number" || value < 0 || value > 1)) throw Object.assign(new Error("主体选区无效"), { status: 400 });
  return body;
}

function parseJsonText(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(cleaned); }
  catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("模型未返回可解析的结构化结果");
  }
}

async function callArk(system, content, maxTokens = 2400) {
  const apiKey = process.env.ARK_API_KEY;
  if (!apiKey) throw Object.assign(new Error("尚未配置 ARK_API_KEY，请在项目 .env 文件中添加重新创建的密钥"), { status: 503, code: "ARK_NOT_CONFIGURED" });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 75_000);
  try {
    const inputContent = content.map((item) => {
      if (item.type === "text") return { type: "input_text", text: item.text };
      if (item.type === "image_url") return { type: "input_image", image_url: item.image_url.url };
      throw new Error(`不支持的模型输入类型：${item.type}`);
    });
    const result = await fetch(`${process.env.ARK_BASE_URL || API_BASE}${process.env.ARK_API_PATH || API_PATH}`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.ARK_VISION_MODEL || MODEL,
        instructions: system,
        input: [{ role: "user", content: inputContent }],
        thinking: { type: "disabled" },
        temperature: 0.1,
        max_output_tokens: maxTokens
      })
    });
    const payload = await result.json().catch(() => ({}));
    if (!result.ok) {
      const message = payload?.error?.message || `方舟接口返回 ${result.status}`;
      throw Object.assign(new Error(message), { status: result.status === 401 ? 502 : 503, code: "ARK_REQUEST_FAILED" });
    }
    const text = (payload?.output || [])
      .filter((item) => item?.type === "message")
      .flatMap((item) => item.content || [])
      .filter((item) => item?.type === "output_text")
      .map((item) => item.text || "")
      .join("");
    if (!text) throw new Error("方舟接口没有返回分析内容");
    return parseJsonText(text);
  } catch (error) {
    if (error.name === "AbortError") throw Object.assign(new Error("图片分析超时，请重试"), { status: 504 });
    throw error;
  } finally { clearTimeout(timeout); }
}

function imageContent(body, instruction) {
  const selectedImage = body.mode === "full" ? body.fullImage : body.subjectImage;
  return [
    { type: "text", text: instruction },
    { type: "image_url", image_url: { url: selectedImage, detail: "high" } }
  ];
}

async function analyzeImage(body) {
  const detailNames = { concise: "简洁", balanced: "平衡", cinematic: "电影级" };
  const scopeInstruction = body.mode === "full"
    ? "输入图片是用户选择的完整画面。分析整张图片的主体、环境、空间与构图。"
    : `输入图片只包含用户框选的目标区域，原图选区比例坐标为 ${JSON.stringify(body.roi)}。只分析框内可见内容，禁止补充框外环境。`;
  const observation = await callArk(OBSERVER_SYSTEM, imageContent(body,
    `${scopeInstruction} 输出包含 subject、scene、spatial_layers、visual_hierarchy、composition、lighting、color、camera、material、mood、uncertainties 的 JSON。每个判断尽可能包含 value、evidence、confidence。`));
  const critique = await callArk(CRITIC_SYSTEM, imageContent(body,
    `${scopeInstruction} 审查以下候选分析并给出修订后的 final_analysis：${JSON.stringify(observation)}`));
  const composition = await callArk(COMPOSER_SYSTEM, [
    { type: "text", text: `输出语言：${body.language === "en" ? "英文" : "中文"}。描述精度：${detailNames[body.detail]}。已审查分析：${JSON.stringify(critique.final_analysis || critique)}` }
  ], 1200);
  if (!composition.prompt || typeof composition.prompt !== "string") throw new Error("提示词生成结果不完整");
  return {
    prompt: composition.prompt.trim(),
    fingerprint: Array.isArray(composition.fingerprint) ? composition.fingerprint.slice(0, 6) : [],
    confidence: typeof composition.confidence === "number" ? composition.confidence : null,
    analysis: critique.final_analysis || critique,
    meta: { model: process.env.ARK_VISION_MODEL || MODEL, api: "responses", scope: body.mode, stages: 3 }
  };
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const requested = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
  const safePath = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, "");
  if (!["index.html", "styles.css", "app.js"].includes(safePath)) return jsonResponse(response, 404, { error: "页面不存在" });
  const filePath = join(ROOT, safePath);
  if (!filePath.startsWith(ROOT)) return jsonResponse(response, 403, { error: "禁止访问" });
  const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml" }[extname(filePath)] || "application/octet-stream";
  try {
    const content = await readFile(filePath);
    response.writeHead(200, { "Content-Type": mime, "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
    response.end(content);
  } catch (error) {
    jsonResponse(response, error.code === "ENOENT" ? 404 : 500, { error: error.code === "ENOENT" ? "页面不存在" : "读取页面失败" });
  }
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
      });
      return response.end();
    }
    if (request.method === "GET" && request.url === "/api/health") return jsonResponse(response, 200, { ok: true, configured: Boolean(process.env.ARK_API_KEY), model: process.env.ARK_VISION_MODEL || MODEL, api: "responses" });
    if (request.method === "POST" && request.url === "/api/analyze") {
      const ip = request.socket.remoteAddress || "unknown";
      if (isRateLimited(ip)) return jsonResponse(response, 429, { error: "请求过于频繁，请稍后再试" });
      const body = validateAnalyzeInput(await readJsonBody(request));
      return jsonResponse(response, 200, await analyzeImage(body));
    }
    if (request.method !== "GET") return jsonResponse(response, 405, { error: "不支持的请求方法" });
    return serveStatic(request, response);
  } catch (error) {
    console.error(`[server] ${error.code || "ERROR"}: ${error.message}`);
    return jsonResponse(response, error.status || 500, { error: error.message || "分析失败，请重试", code: error.code || "ANALYZE_FAILED" });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`逆像已启动：http://127.0.0.1:${PORT}`);
  console.log(process.env.ARK_API_KEY ? `方舟已配置，模型：${process.env.ARK_VISION_MODEL || MODEL}` : "方舟尚未配置：请复制 .env.example 为 .env 并填写重新创建的 ARK_API_KEY");
});
