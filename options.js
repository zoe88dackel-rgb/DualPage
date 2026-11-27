const providerTabs = document.getElementById("providerTabs");
const freeInfoBox = document.getElementById("freeInfoBox");
const apiFormBox = document.getElementById("apiFormBox");
const optApiKey = document.getElementById("optApiKey");
const optBaseUrl = document.getElementById("optBaseUrl");
const optBaseUrlRow = document.getElementById("optBaseUrlRow");
const optModel = document.getElementById("optModel");
const toggleKeyVis = document.getElementById("toggleKeyVis");
const optTestBtn = document.getElementById("optTestBtn");
const optSaveEngineBtn = document.getElementById("optSaveEngineBtn");
const testResult = document.getElementById("testResult");
const optGlossary = document.getElementById("optGlossary");
const optSaveGlossaryBtn = document.getElementById("optSaveGlossaryBtn");
const glossSrcInput = document.getElementById("glossSrcInput");
const glossDstInput = document.getElementById("glossDstInput");
const addGlossaryItemBtn = document.getElementById("addGlossaryItemBtn");
const glossaryList = document.getElementById("glossaryList");
const downloadGlossTplBtn = document.getElementById("downloadGlossTplBtn");
const importGlossBtn = document.getElementById("importGlossBtn");
const exportGlossBtn = document.getElementById("exportGlossBtn");
const importGlossFile = document.getElementById("importGlossFile");
const domainList = document.getElementById("domainList");
const newDomainInput = document.getElementById("newDomainInput");
const addDomainBtn = document.getElementById("addDomainBtn");
const exportBtn = document.getElementById("exportBtn");
const importBtn = document.getElementById("importBtn");
const importFile = document.getElementById("importFile");
const optToast = document.getElementById("optToast");
const themeToggleBtn = document.getElementById("themeToggleBtn");

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  if (themeToggleBtn) {
    themeToggleBtn.textContent = theme === "dark" ? "☀" : "☾";
    themeToggleBtn.title = theme === "dark" ? "切换为浅色模式" : "切换为深色模式";
  }
}

(function initTheme() {
  const saved = localStorage.getItem("dualpage_theme");
  const initial =
    saved === "dark" || saved === "light"
      ? saved
      : window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  applyTheme(initial);
})();

themeToggleBtn?.addEventListener("click", () => {
  const curr = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  const next = curr === "dark" ? "light" : "dark";
  localStorage.setItem("dualpage_theme", next);
  applyTheme(next);
});

const FREE_ENGINES = new Set(["pollinations", "edge", "google"]);
const DEFAULTS = {
  zhipu: { baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash" },
  siliconflow: { baseUrl: "https://api.siliconflow.cn/v1", model: "Qwen/Qwen2.5-7B-Instruct" },
  deepseek: { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  gemini: { baseUrl: "", model: "gemini-2.0-flash" }
};

let settings = null;
let selectedEngine = "edge";

let toastTimer = null;
function showToast(msg) {
  optToast.textContent = msg;
  optToast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => optToast.classList.remove("show"), 2000);
}

function selectEngineTab(eng) {
  selectedEngine = eng;
  providerTabs.querySelectorAll(".p-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.engine === eng);
  });

  const isFree = FREE_ENGINES.has(eng);
  freeInfoBox.classList.toggle("hidden", !isFree);
  apiFormBox.classList.toggle("hidden", isFree);

  if (!isFree) {
    optBaseUrlRow.classList.toggle("hidden", eng === "gemini");
    const prof = settings?.aiProfiles?.[eng] || {};
    const def = DEFAULTS[eng] || { baseUrl: "", model: "" };
    optApiKey.value = prof.apiKey || "";
    optBaseUrl.value = prof.baseUrl || def.baseUrl;
    optModel.value = prof.model || def.model;
  }

  testResult.className = "test-result";
  testResult.textContent = "点击「测试连接」可实时查看译文与延迟";
}

function renderDomains() {
  const list = settings?.autoTranslateDomains || [];
  domainList.innerHTML = "";
  if (list.length === 0) {
    domainList.innerHTML = `<span style="font-size:13px;color:var(--text-tert);">暂无自动翻译网站</span>`;
    return;
  }
  list.forEach((host) => {
    const tag = document.createElement("span");
    tag.className = "domain-tag";
    tag.innerHTML = `<span>${host}</span><button type="button" data-del="${host}" title="移除">✕</button>`;
    domainList.appendChild(tag);
  });
}

async function saveEngineConfig(silent = false) {
  const patch = { engine: selectedEngine };
  if (!FREE_ENGINES.has(selectedEngine)) {
    const prof = {
      apiKey: optApiKey.value.trim(),
      baseUrl: optBaseUrl.value.trim(),
      model: optModel.value.trim()
    };
    patch.ai = prof;
    patch.aiProfiles = { [selectedEngine]: prof };
  }
  const resp = await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings: patch });
  if (resp?.ok) {
    settings = resp.settings;
    if (!silent) showToast("已保存并切换为当前引擎");
  }
  return resp;
}

providerTabs.addEventListener("click", (e) => {
  const btn = e.target.closest(".p-tab");
  if (!btn) return;
  selectEngineTab(btn.dataset.engine);
});

toggleKeyVis.addEventListener("click", () => {
  const isPwd = optApiKey.type === "password";
  optApiKey.type = isPwd ? "text" : "password";
  toggleKeyVis.textContent = isPwd ? "隐藏" : "显示";
});

optSaveEngineBtn.addEventListener("click", () => saveEngineConfig(false));

optTestBtn.addEventListener("click", async () => {
  testResult.className = "test-result";
  testResult.textContent = "正在测试连接...";
  await saveEngineConfig(true);
  const resp = await chrome.runtime.sendMessage({ type: "TEST_ENGINE" });
  if (resp?.ok) {
    testResult.className = "test-result ok";
    testResult.textContent = `连接成功 · ${resp.latencyMs}ms · 测试译文：「${resp.sample}」`;
  } else {
    testResult.className = "test-result err";
    testResult.textContent = resp?.error || "连接失败，请检查 Key 或网络";
  }
});

function parseGlossaryLines(raw) {
  const list = [];
  for (const line of (raw || "").split(/\r?\n/)) {
    const idx = line.indexOf("=");
    if (idx > 0) {
      const src = line.slice(0, idx).trim();
      const dst = line.slice(idx + 1).trim();
      if (src && dst) list.push({ src, dst });
    }
  }
  return list;
}

function serializeGlossaryLines(list) {
  return list.map((item) => `${item.src}=${item.dst}`).join("\n");
}

function renderGlossaryList() {
  if (!glossaryList) return;
  const items = parseGlossaryLines(settings?.customGlossary || "");
  glossaryList.innerHTML = "";
  if (items.length === 0) {
    glossaryList.innerHTML = `<div class="glossary-item" style="color:var(--text-tert);justify-content:center;">暂无自定义术语，可在上方直接输入原文与译文添加</div>`;
    return;
  }
  items.forEach((item, idx) => {
    const row = document.createElement("div");
    row.className = "glossary-item";
    row.innerHTML = `
      <div class="glossary-pair">
        <span class="glossary-src"></span>
        <span class="glossary-arrow">→</span>
        <span class="glossary-dst"></span>
      </div>
      <button type="button" class="glossary-del" data-gidx="${idx}" title="删除">✕</button>
    `;
    row.querySelector(".glossary-src").textContent = item.src;
    row.querySelector(".glossary-dst").textContent = item.dst;
    glossaryList.appendChild(row);
  });
}

async function saveGlossaryText(newText, toastMsg = "术语表已保存") {
  const resp = await chrome.runtime.sendMessage({
    type: "SAVE_SETTINGS",
    settings: { customGlossary: newText }
  });
  if (resp?.ok) {
    settings = resp.settings;
    optGlossary.value = settings.customGlossary || "";
    renderGlossaryList();
    showToast(toastMsg);
  }
}

addGlossaryItemBtn?.addEventListener("click", () => {
  const src = (glossSrcInput?.value || "").trim();
  const dst = (glossDstInput?.value || "").trim();
  if (!src || !dst) {
    showToast("请同时填写原文和指定译文");
    return;
  }
  const items = parseGlossaryLines(settings?.customGlossary || "");
  const existing = items.find((i) => i.src === src);
  if (existing) existing.dst = dst;
  else items.unshift({ src, dst });
  glossSrcInput.value = "";
  glossDstInput.value = "";
  saveGlossaryText(serializeGlossaryLines(items), `已添加术语：${src} → ${dst}`);
});

glossaryList?.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-gidx]");
  if (!btn) return;
  const idx = Number(btn.dataset.gidx);
  const items = parseGlossaryLines(settings?.customGlossary || "");
  if (idx >= 0 && idx < items.length) {
    const removed = items.splice(idx, 1)[0];
    saveGlossaryText(serializeGlossaryLines(items), `已移除术语：${removed.src}`);
  }
});

optSaveGlossaryBtn.addEventListener("click", () => {
  saveGlossaryText(optGlossary.value, "批量术语表已保存");
});

// 解析 CSV 行（兼容带引号和逗号的单元格）
function parseCsvRow(line) {
  const cols = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      cols.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  cols.push(cur.trim());
  return cols;
}

function escapeCsvCell(val) {
  const s = String(val ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadUtf8Csv(filename, content) {
  // 带 UTF-8 BOM，确保 Excel / WPS 打开中文和俄语零乱码
  const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// 1. 下载标准 Excel/WPS 术语表模板
downloadGlossTplBtn?.addEventListener("click", () => {
  const tpl = [
    "原文,译文,备注(导入时自动忽略)",
    "Буст продаж,销量助推,俄语电商示例",
    "Карточка товара,商品卡片,俄语电商示例",
    "Pull Request,合并请求,开发文档示例",
    "Dashboard,控制台,通用网页示例"
  ].join("\r\n");
  downloadUtf8Csv("DualPage-术语表模板.csv", tpl);
  showToast("已下载模板，可用 Excel / WPS 打开编辑");
});

// 2. 导出当前术语表为 CSV
exportGlossBtn?.addEventListener("click", () => {
  const items = parseGlossaryLines(settings?.customGlossary || "");
  if (items.length === 0) {
    showToast("当前暂无自定义术语可导出");
    return;
  }
  const rows = ["原文,译文", ...items.map((i) => `${escapeCsvCell(i.src)},${escapeCsvCell(i.dst)}`)];
  downloadUtf8Csv("DualPage-我的术语表.csv", rows.join("\r\n"));
  showToast(`已导出 ${items.length} 条术语`);
});

// 3. 导入 CSV / TXT 术语表（自动去重合并）
importGlossBtn?.addEventListener("click", () => importGlossFile?.click());

importGlossFile?.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const rawText = (await file.text()).replace(/^\uFEFF/, "");
    const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const existing = parseGlossaryLines(settings?.customGlossary || "");
    const map = new Map(existing.map((i) => [i.src, i.dst]));
    let importedCount = 0;

    for (const line of lines) {
      let src = "";
      let dst = "";
      if (line.includes(",") && !line.includes("=")) {
        const cols = parseCsvRow(line);
        src = cols[0] || "";
        dst = cols[1] || "";
      } else if (line.includes("\t")) {
        const cols = line.split("\t");
        src = (cols[0] || "").trim();
        dst = (cols[1] || "").trim();
      } else if (line.includes("=")) {
        const idx = line.indexOf("=");
        src = line.slice(0, idx).trim();
        dst = line.slice(idx + 1).trim();
      }
      // 自动跳过表头行
      if (!src || !dst) continue;
      if (/^(原文|source|original|term)$/i.test(src) && /^(译文|target|translation)$/i.test(dst)) {
        continue;
      }
      map.set(src, dst);
      importedCount++;
    }

    if (importedCount === 0) {
      showToast("未识别到有效术语，请先下载模板查看格式");
    } else {
      const mergedList = Array.from(map.entries()).map(([src, dst]) => ({ src, dst }));
      await saveGlossaryText(serializeGlossaryLines(mergedList), `成功导入 ${importedCount} 条术语！`);
    }
  } catch {
    showToast("导入失败，请确认文件为 UTF-8 编码的 CSV 或 TXT");
  }
  importGlossFile.value = "";
});

addDomainBtn.addEventListener("click", async () => {
  const raw = newDomainInput.value.trim().replace(/^https?:\/\//i, "").split("/")[0];
  if (!raw) return;
  const set = new Set(settings?.autoTranslateDomains || []);
  set.add(raw);
  const resp = await chrome.runtime.sendMessage({
    type: "SAVE_SETTINGS",
    settings: { autoTranslateDomains: Array.from(set) }
  });
  if (resp?.ok) {
    settings = resp.settings;
    newDomainInput.value = "";
    renderDomains();
    showToast(`已添加 ${raw}`);
  }
});

domainList.addEventListener("click", async (e) => {
  const host = e.target.closest("[data-del]")?.dataset.del;
  if (!host) return;
  const next = (settings?.autoTranslateDomains || []).filter((d) => d !== host);
  const resp = await chrome.runtime.sendMessage({
    type: "SAVE_SETTINGS",
    settings: { autoTranslateDomains: next }
  });
  if (resp?.ok) {
    settings = resp.settings;
    renderDomains();
    showToast(`已移除 ${host}`);
  }
});

// 导出配置（可分享给团队同事导入）
exportBtn.addEventListener("click", () => {
  if (!settings) return;
  const blob = new Blob([JSON.stringify(settings, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "dualpage-config.json";
  a.click();
  URL.revokeObjectURL(url);
  showToast("已导出 dualpage-config.json");
});

importBtn.addEventListener("click", () => importFile.click());

importFile.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const resp = await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings: parsed });
    if (resp?.ok) {
      settings = resp.settings;
      optGlossary.value = settings.customGlossary || "";
      renderGlossaryList();
      renderDomains();
      selectEngineTab(settings.engine || "edge");
      showToast("配置导入成功！");
    }
  } catch {
    showToast("配置文件格式无效");
  }
  importFile.value = "";
});

async function init() {
  const resp = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
  if (resp?.ok) {
    settings = resp.settings;
    optGlossary.value = settings.customGlossary || "";
    renderGlossaryList();
    renderDomains();
    selectEngineTab(settings.engine || "edge");
  }
}

init();
