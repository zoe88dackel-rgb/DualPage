const engineSelect = document.getElementById("engineSelect");
const displayModeSegment = document.getElementById("displayModeSegment");
const targetLangSelect = document.getElementById("targetLangSelect");
const aiConfigBox = document.getElementById("aiConfigBox");
const baseUrlField = document.getElementById("baseUrlField");
const aiApiKey = document.getElementById("aiApiKey");
const aiBaseUrl = document.getElementById("aiBaseUrl");
const aiModel = document.getElementById("aiModel");
const saveAiBtn = document.getElementById("saveAiBtn");
const testEngineBtn = document.getElementById("testEngineBtn");
const selectionCheck = document.getElementById("selectionCheck");
const imageTranslateCheck = document.getElementById("imageTranslateCheck");
const glossaryCheck = document.getElementById("glossaryCheck");
const floatingBtnCheck = document.getElementById("floatingBtnCheck");
const autoDomainCheck = document.getElementById("autoDomainCheck");
const toggleGlossaryEditor = document.getElementById("toggleGlossaryEditor");
const glossaryChevron = document.getElementById("glossaryChevron");
const customGlossaryBox = document.getElementById("customGlossaryBox");
const customGlossaryInput = document.getElementById("customGlossaryInput");
const saveGlossaryBtn = document.getElementById("saveGlossaryBtn");
const openGuideBtn = document.getElementById("openGuideBtn");
const popupBrandLink = document.getElementById("popupBrandLink");
const openOptionsBtn = document.getElementById("openOptionsBtn");
const toggleBtn = document.getElementById("toggleBtn");
const toggleBtnText = document.getElementById("toggleBtnText");
const currentHostEl = document.getElementById("currentHost");
const statusMsg = document.getElementById("statusMsg");

let currentTabId = null;
let currentTabUrl = "";
let currentHostname = "";
let currentSettings = null;
let pageActive = false;
let selectedDisplayMode = "replace";

const ENGINE_PRESETS = {
  zhipu: { baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash" },
  siliconflow: { baseUrl: "https://api.siliconflow.cn/v1", model: "Qwen/Qwen2.5-7B-Instruct" },
  deepseek: { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  gemini: { baseUrl: "", model: "gemini-2.0-flash" }
};

function isInjectableUrl(url) {
  return /^https?:\/\//i.test(url || "");
}

async function sendMessageWithAutoInject(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    if (!isInjectableUrl(currentTabUrl)) {
      throw new Error("浏览器系统页面不支持注入翻译");
    }
    await chrome.scripting.insertCSS({ target: { tabId }, files: ["content.css"] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    await new Promise((r) => setTimeout(r, 90));
    return await chrome.tabs.sendMessage(tabId, message);
  }
}

function setSegmentUI(mode) {
  selectedDisplayMode = mode === "bilingual" ? "bilingual" : "replace";
  displayModeSegment.querySelectorAll(".seg-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.value === selectedDisplayMode);
  });
}

function updateAiVisibility() {
  const eng = engineSelect.value;
  const isAiKeyRequired =
    eng === "zhipu" || eng === "siliconflow" || eng === "deepseek" || eng === "openai" || eng === "gemini";
  aiConfigBox.classList.toggle("hidden", !isAiKeyRequired);
  baseUrlField.classList.toggle("hidden", eng === "gemini");

  if (isAiKeyRequired) {
    const prof = currentSettings?.aiProfiles?.[eng] || {};
    const preset = ENGINE_PRESETS[eng] || { baseUrl: "", model: "" };
    aiApiKey.value = prof.apiKey || "";
    aiModel.value = prof.model || preset.model;
    if (eng !== "gemini") {
      aiBaseUrl.value = prof.baseUrl || preset.baseUrl;
    }
  }
}

function updateToggleBtnUI() {
  toggleBtn.classList.toggle("active", pageActive);
  toggleBtnText.textContent = pageActive ? "实时翻译运行中 · 点击恢复原文" : "开始实时翻译";
}

let statusTimer = null;
function showStatus(msg, isError = false) {
  statusMsg.textContent = msg;
  statusMsg.classList.toggle("error", isError);
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    if (statusMsg.textContent === msg) statusMsg.textContent = "";
  }, 2600);
}

async function persistAndSync(patch, toastText = "已应用设置") {
  const resp = await chrome.runtime.sendMessage({
    type: "SAVE_SETTINGS",
    settings: patch
  });
  if (!resp?.ok) {
    showStatus("保存失败", true);
    return false;
  }
  currentSettings = resp.settings;
  if (toastText) showStatus(toastText);

  if (currentTabId && isInjectableUrl(currentTabUrl)) {
    try {
      await sendMessageWithAutoInject(currentTabId, {
        type: "APPLY_SETTINGS_AND_RETRANSLATE",
        settings: currentSettings
      });
    } catch {
      // 忽略系统页面
    }
  }
  return true;
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    currentTabId = tab.id;
    currentTabUrl = tab.url || "";
    try {
      const urlObj = new URL(currentTabUrl);
      currentHostname = urlObj.hostname;
      currentHostEl.textContent = currentHostname || "当前标签页";
    } catch {
      currentHostEl.textContent = "系统页面（不支持翻译）";
    }
  }

  const res = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
  if (res?.ok) {
    currentSettings = res.settings;
    engineSelect.value = currentSettings.engine || "edge";
    setSegmentUI(currentSettings.displayMode || "replace");
    targetLangSelect.value = currentSettings.targetLang || "zh-CN";
    aiApiKey.value = currentSettings.ai?.apiKey || "";
    aiBaseUrl.value = currentSettings.ai?.baseUrl || "https://api.deepseek.com/v1";
    aiModel.value = currentSettings.ai?.model || "deepseek-chat";
    selectionCheck.checked = currentSettings.enableSelectionTranslate !== false;
    if (imageTranslateCheck) imageTranslateCheck.checked = currentSettings.enableImageTranslate !== false;
    glossaryCheck.checked = currentSettings.useGlossary !== false;
    floatingBtnCheck.checked = currentSettings.showFloatingBtn !== false;
    customGlossaryInput.value = currentSettings.customGlossary || "";
    autoDomainCheck.checked = (currentSettings.autoTranslateDomains || []).includes(currentHostname);
    updateAiVisibility();
  }

  if (currentTabId && isInjectableUrl(currentTabUrl)) {
    try {
      const stateResp = await chrome.tabs.sendMessage(currentTabId, { type: "GET_PAGE_STATE" });
      if (stateResp?.ok) {
        pageActive = !!stateResp.isActive;
        updateToggleBtnUI();
      }
    } catch {
      // 未注入时保持关闭状态，点击主按钮自动热注入
    }
  }
}

toggleBtn.addEventListener("click", async () => {
  if (!currentTabId) return;
  try {
    const resp = await sendMessageWithAutoInject(currentTabId, { type: "TOGGLE_TRANSLATE" });
    if (resp?.ok) {
      pageActive = !!resp.isActive;
      updateToggleBtnUI();
      showStatus(pageActive ? "已开启实时翻译" : "已恢复原文");
    }
  } catch (err) {
    showStatus(err.message || "当前页面不支持翻译", true);
  }
});

displayModeSegment.addEventListener("click", (e) => {
  const btn = e.target.closest(".seg-btn");
  if (!btn) return;
  const mode = btn.dataset.value;
  if (mode === selectedDisplayMode) return;
  setSegmentUI(mode);
  persistAndSync({ displayMode: mode }, mode === "bilingual" ? "已切换为双语对照" : "已切换为仅译文");
});

targetLangSelect.addEventListener("change", () => {
  persistAndSync({ targetLang: targetLangSelect.value }, "已更新目标语言");
});

engineSelect.addEventListener("change", () => {
  updateAiVisibility();
  const eng = engineSelect.value;
  if (eng === "pollinations" || eng === "edge" || eng === "google") {
    persistAndSync({ engine: eng }, "已切换翻译引擎");
  } else if (currentSettings?.aiProfiles?.[eng]?.apiKey) {
    // 如果该平台已经在 API 配置页存过 Key，切换即自动生效
    persistAndSync({ engine: eng, ai: currentSettings.aiProfiles[eng] }, "已切换至已配置的 AI 引擎");
  }
});

saveAiBtn.addEventListener("click", () => {
  persistAndSync(
    {
      engine: engineSelect.value,
      ai: {
        apiKey: aiApiKey.value.trim(),
        baseUrl: aiBaseUrl.value.trim(),
        model: aiModel.value.trim()
      }
    },
    "AI 配置已保存并生效"
  );
});

testEngineBtn.addEventListener("click", async () => {
  showStatus("正在测试连接...");
  await persistAndSync(
    {
      engine: engineSelect.value,
      ai: {
        apiKey: aiApiKey.value.trim(),
        baseUrl: aiBaseUrl.value.trim(),
        model: aiModel.value.trim()
      }
    },
    ""
  );
  const resp = await chrome.runtime.sendMessage({ type: "TEST_ENGINE" });
  if (resp?.ok) {
    showStatus(`连接成功 · ${resp.latencyMs || 0}ms · ${resp.sample}`);
  } else {
    showStatus(resp?.error || "连接失败，请检查 Key", true);
  }
});

autoDomainCheck.addEventListener("change", async () => {
  if (!currentHostname || !currentSettings) return;
  const list = new Set(currentSettings.autoTranslateDomains || []);
  if (autoDomainCheck.checked) list.add(currentHostname);
  else list.delete(currentHostname);
  await persistAndSync(
    { autoTranslateDomains: Array.from(list) },
    autoDomainCheck.checked ? `已设为自动翻译 ${currentHostname}` : "已取消该站自动翻译"
  );
});

selectionCheck.addEventListener("change", () => {
  persistAndSync(
    { enableSelectionTranslate: selectionCheck.checked },
    selectionCheck.checked ? "已开启划词即译" : "已关闭划词即译"
  );
});

imageTranslateCheck?.addEventListener("change", () => {
  persistAndSync(
    { enableImageTranslate: imageTranslateCheck.checked },
    imageTranslateCheck.checked ? "已开启图片悬停译图" : "已关闭图片悬停译图"
  );
});

glossaryCheck.addEventListener("change", () => {
  persistAndSync(
    { useGlossary: glossaryCheck.checked },
    glossaryCheck.checked ? "已开启电商术语优化" : "已关闭术语优化"
  );
});

floatingBtnCheck.addEventListener("change", () => {
  persistAndSync(
    { showFloatingBtn: floatingBtnCheck.checked },
    floatingBtnCheck.checked ? "已显示悬浮球" : "已隐藏悬浮球"
  );
});

toggleGlossaryEditor.addEventListener("click", () => {
  const hidden = customGlossaryBox.classList.toggle("hidden");
  glossaryChevron.textContent = hidden ? "展开 ›" : "收起 ⌄";
});

saveGlossaryBtn.addEventListener("click", () => {
  persistAndSync(
    { customGlossary: customGlossaryInput.value },
    "自定义术语表已保存并生效"
  );
});

const openGuidePage = () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("guide.html") });
};

openGuideBtn?.addEventListener("click", openGuidePage);
popupBrandLink?.addEventListener("click", openGuidePage);

openOptionsBtn?.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

init();
