const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = {
  imageReady: false,
  analysisMode: "subject",
  prompt: "",
  generated: 0,
};

const refs = {
  fileInput: $("#fileInput"), dropzone: $("#dropzone"), emptyState: $("#emptyState"),
  preview: $("#preview"), scanOverlay: $("#scanOverlay"), imageActions: $("#imageActions"),
  fileName: $("#fileName"), replaceBtn: $("#replaceBtn"), sampleBtn: $("#sampleBtn"),
  chips: $("#analysisChips"), generateBtn: $("#generateBtn"), statusText: $("#statusText"),
  status: $(".status"), language: $("#languageSelect"),
  detail: $("#detailRange"), detailValue: $("#detailValue"), output: $("#promptOutput"),
  copyBtn: $("#copyBtn"), downloadBtn: $("#downloadBtn"), wordCount: $("#wordCount"),
  toast: $("#toast"), historyCount: $("#historyCount"), focusBox: $("#focusBox"),
  scopeHint: $("#scopeHint"), fullFrameLabel: $("#fullFrameLabel"),
};

function modeLabel(mode = state.analysisMode) {
  return mode === "full" ? "整张图片" : "框选区域";
}

function idleGenerateLabel(prefix = "识别") {
  return `${prefix}${modeLabel()}并生成`;
}

function setAnalysisMode(mode, announce = true) {
  if (!['subject', 'full'].includes(mode)) return;
  state.analysisMode = mode;
  $$('[data-analysis-mode]').forEach((button) => {
    const active = button.dataset.analysisMode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  refs.scanOverlay.classList.toggle("full-mode", mode === "full");
  refs.fullFrameLabel.hidden = mode !== "full";
  refs.focusBox.tabIndex = mode === "subject" ? 0 : -1;
  refs.scopeHint.textContent = mode === "full"
    ? "分析主体、环境与构图，生成完整画面的提示词。"
    : "只识别目标框内的主体，拖动或缩放框来调整。";
  if (!refs.generateBtn.classList.contains("loading")) {
    refs.generateBtn.querySelector(".button-label").textContent = idleGenerateLabel(state.prompt ? "重新识别" : "识别");
  }
  if (state.imageReady) {
    refs.statusText.textContent = mode === "full" ? "整图识别已就绪" : "主体框已就绪";
    refs.chips.className = "chips ready";
    refs.chips.innerHTML = mode === "full"
      ? "<span>整张图片</span><span>主体 + 环境 + 构图</span>"
      : "<span>仅目标框</span><span>可拖动缩放</span>";
    if (announce) showToast(mode === "full" ? "将识别整张图片" : "将只识别目标框内容");
  }
}

const samples = {
  zh: {
    concise: "一位独行者站在巨大雾蓝色冰川前，背对镜头，极简构图，冷调自然光，电影感，宁静而敬畏的氛围",
    balanced: "一位身穿深色户外服的独行者背对镜头，站在巨大雾蓝色冰川前；人物置于画面下方三分之一，广角远景，低饱和冷色调，阴天漫射光，冰面细节清晰，空气透视与轻雾，克制、孤独且带有敬畏感的电影摄影",
    cinematic: "史诗级环境人像：一位身穿炭黑色户外服的独行者背对镜头，凝视横贯画面的巨大雾蓝色冰川。人物极小并落在下方三分之一处，以宏大的负空间强调人与自然的尺度反差；24mm 广角远景，平视机位，阴天柔和漫射光，低饱和青灰色调，冰川裂隙和半透明层次纤细可见，轻雾形成空气透视，细腻胶片颗粒，冷峻、安静、令人敬畏的电影剧照质感"
  },
  en: {
    concise: "A solitary traveler facing a monumental mist-blue glacier, back to camera, minimal composition, cool natural light, cinematic, quiet sense of awe",
    balanced: "A solitary traveler in dark outdoor clothing, seen from behind, standing before a monumental mist-blue glacier; subject placed in the lower third, wide establishing shot, desaturated cool palette, soft overcast daylight, crisp ice textures, atmospheric haze, restrained cinematic photography, solitude and awe",
    cinematic: "Epic environmental portrait of a solitary traveler in charcoal outdoor clothing, seen from behind, contemplating a monumental mist-blue glacier spanning the frame. Tiny human figure in the lower third, vast negative space emphasizing scale, 24mm wide-angle establishing shot at eye level, soft diffused overcast light, desaturated cyan-gray palette, delicate translucent ice fissures, atmospheric haze, fine analog film grain, austere and contemplative cinematic still"
  }
};

function setImage(src, name = "reference.jpg") {
  ["left", "top", "width", "height"].forEach((property) => refs.focusBox.style.removeProperty(property));
  refs.preview.src = src;
  refs.preview.hidden = false;
  refs.emptyState.hidden = true;
  refs.scanOverlay.hidden = false;
  refs.imageActions.hidden = false;
  refs.dropzone.classList.add("loaded");
  refs.fileName.textContent = name.length > 26 ? `${name.slice(0, 23)}…` : name;
  state.imageReady = true;
  refs.generateBtn.disabled = false;
  refs.status.classList.add("active");
  setAnalysisMode(state.analysisMode, false);
}

function handleFile(file) {
  if (!file) return;
  if (!file.type.startsWith("image/")) return showToast("请选择图片文件");
  if (file.size > 10 * 1024 * 1024) return showToast("图片不能超过 10MB");
  const reader = new FileReader();
  reader.onload = (event) => setImage(event.target.result, file.name);
  reader.readAsDataURL(file);
}

function useSample() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">
    <defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#a8c3cd"/><stop offset="1" stop-color="#dce4e5"/></linearGradient><linearGradient id="ice" x2="1" y2="1"><stop stop-color="#93bcc7"/><stop offset=".48" stop-color="#d3e4e4"/><stop offset="1" stop-color="#668e9e"/></linearGradient></defs>
    <rect width="1200" height="900" fill="url(#sky)"/><path d="M0 430L120 380 245 405 350 302 470 360 590 255 730 350 850 280 970 355 1090 310 1200 370V900H0Z" fill="url(#ice)"/><path d="M0 665Q230 585 430 690T850 650 1200 690V900H0Z" fill="#c4d4d5"/><path d="M0 760Q280 690 540 760T1200 735V900H0Z" fill="#718b91" opacity=".55"/><g fill="none" stroke="#577d8b" opacity=".45"><path d="M350 302l55 315M590 255l-12 390M850 280l52 360M970 355l-30 285"/></g><g transform="translate(570 590)"><circle cx="0" cy="-44" r="15" fill="#1b252b"/><path d="M-22-25Q0-40 22-25L35 85H-35Z" fill="#202b30"/><path d="M-12 82l-18 92M12 82l24 92" stroke="#151d21" stroke-width="18"/><path d="M-23-12l-44 70M23-12l48 65" stroke="#202b30" stroke-width="14"/></g><rect width="1200" height="900" fill="#607b88" opacity=".08"/></svg>`;
  setImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, "glacier-solitude.jpg");
}

function getRoi() {
  const overlay = refs.scanOverlay.getBoundingClientRect();
  const box = refs.focusBox.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (box.left - overlay.left) / overlay.width)),
    y: Math.max(0, Math.min(1, (box.top - overlay.top) / overlay.height)),
    width: Math.max(0, Math.min(1, box.width / overlay.width)),
    height: Math.max(0, Math.min(1, box.height / overlay.height))
  };
}

function prepareImages() {
  const roi = state.analysisMode === "full" ? { x: 0, y: 0, width: 1, height: 1 } : getRoi();
  const sourceWidth = refs.preview.naturalWidth;
  const sourceHeight = refs.preview.naturalHeight;
  if (!sourceWidth || !sourceHeight) throw new Error("图片尚未加载完成");
  const scale = Math.min(1, 1600 / Math.max(sourceWidth, sourceHeight));
  const fullCanvas = document.createElement("canvas");
  fullCanvas.width = Math.max(1, Math.round(sourceWidth * scale));
  fullCanvas.height = Math.max(1, Math.round(sourceHeight * scale));
  fullCanvas.getContext("2d").drawImage(refs.preview, 0, 0, fullCanvas.width, fullCanvas.height);
  if (state.analysisMode === "full") {
    return {
      mode: "full",
      fullImage: fullCanvas.toDataURL("image/jpeg", 0.9),
      roi
    };
  }
  const cropX = Math.round(roi.x * sourceWidth);
  const cropY = Math.round(roi.y * sourceHeight);
  const cropWidth = Math.max(1, Math.round(roi.width * sourceWidth));
  const cropHeight = Math.max(1, Math.round(roi.height * sourceHeight));
  const cropScale = Math.min(1, 1200 / Math.max(cropWidth, cropHeight));
  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = Math.max(1, Math.round(cropWidth * cropScale));
  cropCanvas.height = Math.max(1, Math.round(cropHeight * cropScale));
  cropCanvas.getContext("2d").drawImage(refs.preview, cropX, cropY, cropWidth, cropHeight, 0, 0, cropCanvas.width, cropCanvas.height);
  return {
    mode: "subject",
    fullImage: fullCanvas.toDataURL("image/jpeg", 0.9),
    subjectImage: cropCanvas.toDataURL("image/jpeg", 0.92),
    roi
  };
}

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
}

function completeGeneration(result) {
  state.prompt = result.prompt;
  if (Array.isArray(result.fingerprint) && result.fingerprint.length) {
    refs.chips.className = "chips ready";
    refs.chips.innerHTML = result.fingerprint.map((item) => `<span>${escapeHtml(String(item))}</span>`).join("");
  }
  renderOutput();
  refs.generateBtn.querySelector(".button-label").textContent = idleGenerateLabel("重新识别");
  refs.copyBtn.disabled = false;
  refs.downloadBtn.disabled = false;
  refs.statusText.textContent = result.confidence ? `${modeLabel()}完成 · ${Math.round(result.confidence * 100)}%` : `${modeLabel()}完成`;
  state.generated += 1;
  refs.historyCount.textContent = state.generated;
  showToast("提示词已生成");
}

async function generate() {
  if (!state.imageReady) return;
  refs.generateBtn.classList.add("loading");
  refs.generateBtn.querySelector(".button-label").textContent = "正在进行专业分析…";
  refs.generateBtn.disabled = true;
  refs.statusText.textContent = `${modeLabel()}分析中`;
  refs.output.classList.remove("empty");
  refs.output.textContent = state.analysisMode === "full"
    ? "正在识别整张图片的主体、环境、构图与光色，然后进行视觉证据复核…"
    : "正在只识别目标框内的内容，然后进行视觉证据复核…";
  try {
    const language = refs.language.value;
    const levels = ["concise", "balanced", "cinematic"];
    const apiEndpoint = location.protocol === "file:"
      ? "http://127.0.0.1:4173/api/analyze"
      : "/api/analyze";
    const response = await fetch(apiEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...prepareImages(), language, detail: levels[Number(refs.detail.value) - 1] })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "图片分析失败，请重试");
    completeGeneration(result);
  } catch (error) {
    refs.output.classList.remove("empty");
    const localHint = location.protocol === "file:"
      ? "\n\n当前页面由本地文件打开。请先在项目目录运行 npm start，再重新生成。"
      : "";
    refs.output.textContent = `${error.message}${localHint}\n\n如果尚未配置方舟，请检查 .env 中的 ARK_API_KEY，然后重启服务。`;
    refs.statusText.textContent = "生成失败";
    showToast("生成失败，请查看提示");
  } finally {
    refs.generateBtn.classList.remove("loading");
    refs.generateBtn.disabled = false;
    if (!state.prompt) refs.generateBtn.querySelector(".button-label").textContent = idleGenerateLabel();
  }
}

function renderOutput() {
  refs.output.textContent = state.prompt;
  refs.wordCount.textContent = `${state.prompt.length} 字符`;
}

function showToast(message) {
  refs.toast.textContent = message;
  refs.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => refs.toast.classList.remove("show"), 1800);
}

function updateFocusDescription() {
  const overlayRect = refs.scanOverlay.getBoundingClientRect();
  const boxRect = refs.focusBox.getBoundingClientRect();
  const left = boxRect.left - overlayRect.left;
  const top = boxRect.top - overlayRect.top;
  const maxLeft = Math.max(0, overlayRect.width - boxRect.width);
  const maxTop = Math.max(0, overlayRect.height - boxRect.height);
  const horizontal = left < maxLeft / 3 ? "左侧" : left > maxLeft * 2 / 3 ? "右侧" : "中央";
  const vertical = top < maxTop / 3 ? "上方" : top > maxTop * 2 / 3 ? "下方" : "中部";
  const width = Math.round(boxRect.width / overlayRect.width * 100);
  const height = Math.round(boxRect.height / overlayRect.height * 100);
  refs.focusBox.setAttribute("aria-valuetext", `画面${horizontal}${vertical}，选区宽 ${width}%，高 ${height}%`);
}

function moveFocusBox(left, top) {
  const overlayRect = refs.scanOverlay.getBoundingClientRect();
  const boxRect = refs.focusBox.getBoundingClientRect();
  const maxLeft = Math.max(0, overlayRect.width - boxRect.width);
  const maxTop = Math.max(0, overlayRect.height - boxRect.height);
  const nextLeft = Math.min(Math.max(0, left), maxLeft);
  const nextTop = Math.min(Math.max(0, top), maxTop);
  refs.focusBox.style.left = `${nextLeft}px`;
  refs.focusBox.style.top = `${nextTop}px`;
  updateFocusDescription();
}

let focusDrag = null;
refs.focusBox.addEventListener("pointerdown", (event) => {
  if (!state.imageReady || state.analysisMode !== "subject") return;
  event.preventDefault();
  event.stopPropagation();
  const overlayRect = refs.scanOverlay.getBoundingClientRect();
  const boxRect = refs.focusBox.getBoundingClientRect();
  const resizeHandle = event.target.closest("[data-resize]");
  if (resizeHandle) {
    focusDrag = {
      mode: "resize", direction: resizeHandle.dataset.resize,
      startX: event.clientX, startY: event.clientY,
      left: boxRect.left - overlayRect.left, top: boxRect.top - overlayRect.top,
      width: boxRect.width, height: boxRect.height, overlayRect
    };
    refs.focusBox.classList.add("resizing");
  } else {
    focusDrag = { mode: "move", offsetX: event.clientX - boxRect.left, offsetY: event.clientY - boxRect.top, overlayRect };
    refs.focusBox.classList.add("dragging");
  }
  refs.focusBox.setPointerCapture(event.pointerId);
});
function updateFocusInteraction(event) {
  if (!focusDrag) return;
  if (focusDrag.mode === "move") {
    moveFocusBox(event.clientX - focusDrag.overlayRect.left - focusDrag.offsetX, event.clientY - focusDrag.overlayRect.top - focusDrag.offsetY);
    return;
  }
  const minSize = 72;
  const dx = event.clientX - focusDrag.startX;
  const dy = event.clientY - focusDrag.startY;
  const east = focusDrag.direction.includes("e");
  const south = focusDrag.direction.includes("s");
  let width = east ? focusDrag.width + dx : focusDrag.width - dx;
  let height = south ? focusDrag.height + dy : focusDrag.height - dy;
  const maxWidth = east ? focusDrag.overlayRect.width - focusDrag.left : focusDrag.left + focusDrag.width;
  const maxHeight = south ? focusDrag.overlayRect.height - focusDrag.top : focusDrag.top + focusDrag.height;
  width = Math.min(Math.max(minSize, width), maxWidth);
  height = Math.min(Math.max(minSize, height), maxHeight);
  const left = east ? focusDrag.left : focusDrag.left + focusDrag.width - width;
  const top = south ? focusDrag.top : focusDrag.top + focusDrag.height - height;
  refs.focusBox.style.left = `${left}px`;
  refs.focusBox.style.top = `${top}px`;
  refs.focusBox.style.width = `${width}px`;
  refs.focusBox.style.height = `${height}px`;
  updateFocusDescription();
}
window.addEventListener("pointermove", updateFocusInteraction);
function endFocusDrag(event = {}) {
  if (!focusDrag) return;
  focusDrag = null;
  refs.focusBox.classList.remove("dragging", "resizing");
  if (Number.isInteger(event.pointerId) && refs.focusBox.hasPointerCapture(event.pointerId)) refs.focusBox.releasePointerCapture(event.pointerId);
}
window.addEventListener("pointerup", endFocusDrag);
window.addEventListener("pointercancel", endFocusDrag);
// Older embedded browsers occasionally drop captured pointer movement; mouse events keep desktop resizing reliable.
window.addEventListener("mousemove", (event) => {
  if (focusDrag && event.buttons === 1) updateFocusInteraction(event);
});
window.addEventListener("mouseup", endFocusDrag);
window.addEventListener("blur", () => endFocusDrag());
refs.focusBox.addEventListener("keydown", (event) => {
  const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (!directions[event.key] || !state.imageReady || state.analysisMode !== "subject") return;
  event.preventDefault();
  const overlayRect = refs.scanOverlay.getBoundingClientRect();
  const boxRect = refs.focusBox.getBoundingClientRect();
  const step = event.shiftKey ? 20 : 5;
  const [x, y] = directions[event.key];
  moveFocusBox(boxRect.left - overlayRect.left + x * step, boxRect.top - overlayRect.top + y * step);
});

refs.fileInput.addEventListener("change", (event) => handleFile(event.target.files[0]));
refs.sampleBtn.addEventListener("click", useSample);
refs.replaceBtn.addEventListener("click", (event) => { event.preventDefault(); refs.fileInput.click(); });
["dragenter", "dragover"].forEach((name) => refs.dropzone.addEventListener(name, (event) => { event.preventDefault(); refs.dropzone.classList.add("dragging"); }));
["dragleave", "drop"].forEach((name) => refs.dropzone.addEventListener(name, (event) => { event.preventDefault(); refs.dropzone.classList.remove("dragging"); }));
refs.dropzone.addEventListener("drop", (event) => handleFile(event.dataTransfer.files[0]));
refs.dropzone.addEventListener("click", (event) => { if (state.imageReady && event.target.id !== "replaceBtn") event.preventDefault(); });
refs.detail.addEventListener("input", () => refs.detailValue.textContent = ["简洁", "平衡", "电影级"][Number(refs.detail.value) - 1]);
$$('[data-analysis-mode]').forEach((button) => button.addEventListener("click", () => setAnalysisMode(button.dataset.analysisMode)));
refs.generateBtn.addEventListener("click", generate);
refs.copyBtn.addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(state.prompt); showToast("已复制提示词"); }
  catch { showToast("复制失败，请手动选择文本"); }
});
refs.downloadBtn.addEventListener("click", () => {
  const content = `图片提示词\n${state.prompt}`;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
  link.download = "逆像-提示词.txt";
  link.click();
  URL.revokeObjectURL(link.href);
});
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !refs.generateBtn.disabled) generate();
});
$("#historyBtn").addEventListener("click", () => showToast(state.generated ? `本次已生成 ${state.generated} 条记录` : "还没有生成记录"));
$(".avatar-button").addEventListener("click", () => showToast("账户功能将在正式版开放"));

setAnalysisMode(state.analysisMode, false);
