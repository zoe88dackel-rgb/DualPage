// DualPage v2.3.1 — 高速多引擎后台服务（跨页缓存 + 浏览器本地 AI + 三级自动兜底）
const DEFAULT_SETTINGS = {
  engine: "google", // google | browser | pollinations | zhipu | siliconflow | deepseek | openai | gemini
  targetLang: "zh-CN", // zh-CN | en | ru
  displayMode: "replace", // replace | bilingual
  showFloatingBtn: true,
  enableSelectionTranslate: true,
  enableImageTranslate: true,
  useGlossary: true,
  customGlossary: "",
  autoTranslateDomains: [],
  ai: {
    apiKey: "",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat"
  },
  aiProfiles: {
    zhipu: { apiKey: "", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash" },
    siliconflow: { apiKey: "", baseUrl: "https://api.siliconflow.cn/v1", model: "Qwen/Qwen2.5-7B-Instruct" },
    deepseek: { apiKey: "", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
    openai: { apiKey: "", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
    gemini: { apiKey: "", baseUrl: "", model: "gemini-2.0-flash" }
  }
};

const ECOMMERCE_GLOSSARY = {
  "Буст продаж": "销量助推",
  "буст продаж": "销量助推",
  "Буст показов": "曝光助推",
  "Карточка товара": "商品卡片",
  "карточка товара": "商品卡片",
  "Отзывы за баллы": "评价返积分",
  "Индекс качества": "店铺质量分",
  "Поисковая выдача": "搜索结果页",
  "Мультипоставка": "多仓配货",
  "Гарантия дохода": "收入保障",
  "Личный кабинет": "卖家后台",
  "Продвижение": "推广营销",
  "Остатки": "库存",
  "Поставки": "供货/入仓",
  "Витрина": "店铺展台",
  "Ставка": "出价",
  "Аукцион второй цены": "二价拍卖",
  "ПВЗ": "自提点"
};

let edgeTokenCache = { token: "", expiresAt: 0 };
let edgeTokenPromise = null;
let cachedSettings = null;

// 跨标签页 & 跨天持久化本地缓存（LRU，最多 5000 条，仅占 <1MB 硬盘，0% GPU）
const MAX_CACHE_SIZE = 5000;
const globalCache = new Map();
let cacheLoaded = false;
let cacheSaveTimer = null;

async function ensureSessionCacheLoaded() {
  if (cacheLoaded) return;
  cacheLoaded = true;
  try {
    const [sessionRes, localRes] = await Promise.all([
      chrome.storage.session.get("lwtEdgeToken").catch(() => ({})),
      chrome.storage.local.get("lwtPersistentCache").catch(() => ({}))
    ]);
    if (sessionRes?.lwtEdgeToken?.token && Date.now() < sessionRes.lwtEdgeToken.expiresAt) {
      edgeTokenCache = sessionRes.lwtEdgeToken;
    }
    if (Array.isArray(localRes?.lwtPersistentCache)) {
      for (const [k, v] of localRes.lwtPersistentCache) {
        globalCache.set(k, v);
      }
    }
  } catch {
    // 忽略存储不可用
  }
}

function setGlobalCache(key, val) {
  if (globalCache.has(key)) globalCache.delete(key);
  globalCache.set(key, val);
  if (globalCache.size > MAX_CACHE_SIZE) {
    const oldestKey = globalCache.keys().next().value;
    globalCache.delete(oldestKey);
  }
  clearTimeout(cacheSaveTimer);
  cacheSaveTimer = setTimeout(() => {
    try {
      const entries = Array.from(globalCache.entries()).slice(-3000);
      chrome.storage.local.set({ lwtPersistentCache: entries });
    } catch {
      // 忽略
    }
  }, 1500);
}

// 带超时的 fetch，防止单个接口卡死拖慢整页
async function fetchWithTimeout(url, options = {}, timeoutMs = 4500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.sync.get("settings");
  if (!existing.settings) {
    await chrome.storage.sync.set({ settings: DEFAULT_SETTINGS });
  }
  getEdgeToken().catch(() => {});

  // 注册浏览器右键菜单（翻译网页 / 翻译选中文字 / 翻译图片文字）
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "dp-toggle-page",
      title: "DualPage：翻译 / 还原当前网页",
      contexts: ["page"]
    });
    chrome.contextMenus.create({
      id: "dp-translate-selection",
      title: "DualPage：翻译选中文字",
      contexts: ["selection"]
    });
    chrome.contextMenus.create({
      id: "dp-translate-image",
      title: "DualPage：翻译图片中的文字",
      contexts: ["image"]
    });
    chrome.contextMenus.create({
      id: "dp-region-ocr",
      title: "DualPage：框选截屏译图 (Alt+I)",
      contexts: ["page", "image"]
    });
  });
});

async function sendTabMsgWithInject(tabId, msg) {
  try {
    return await chrome.tabs.sendMessage(tabId, msg);
  } catch {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ["content.css"] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    await new Promise((r) => setTimeout(r, 90));
    return await chrome.tabs.sendMessage(tabId, msg);
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id || !/^https?:\/\//i.test(tab.url || "")) return;
  if (info.menuItemId === "dp-toggle-page") {
    sendTabMsgWithInject(tab.id, { type: "TOGGLE_TRANSLATE" }).catch(() => {});
  } else if (info.menuItemId === "dp-translate-selection" && info.selectionText) {
    sendTabMsgWithInject(tab.id, {
      type: "TRANSLATE_SELECTION_FROM_MENU",
      text: info.selectionText
    }).catch(() => {});
  } else if (info.menuItemId === "dp-translate-image" && info.srcUrl) {
    sendTabMsgWithInject(tab.id, {
      type: "TRANSLATE_IMAGE_URL",
      srcUrl: info.srcUrl
    }).catch(() => {});
  } else if (info.menuItemId === "dp-region-ocr") {
    sendTabMsgWithInject(tab.id, { type: "START_REGION_CAPTURE" }).catch(() => {});
  }
});

async function getSettings() {
  if (cachedSettings) return cachedSettings;
  const res = await chrome.storage.sync.get("settings");
  const saved = res.settings || {};
  const mergedProfiles = { ...DEFAULT_SETTINGS.aiProfiles };
  if (saved.aiProfiles) {
    for (const k of Object.keys(mergedProfiles)) {
      mergedProfiles[k] = { ...mergedProfiles[k], ...(saved.aiProfiles[k] || {}) };
    }
  }
  cachedSettings = {
    ...DEFAULT_SETTINGS,
    ...saved,
    // 自动迁移已下线的旧版 edge 免费接口到 google
    engine: saved.engine === "edge" ? "google" : (saved.engine || DEFAULT_SETTINGS.engine),
    ai: {
      ...DEFAULT_SETTINGS.ai,
      ...(saved.ai || {})
    },
    aiProfiles: mergedProfiles
  };
  return cachedSettings;
}

function getActiveAiConfig(settings) {
  const eng = settings.engine;
  if (settings.aiProfiles && Object.prototype.hasOwnProperty.call(settings.aiProfiles, eng)) {
    return settings.aiProfiles[eng];
  }
  return settings.ai || DEFAULT_SETTINGS.ai;
}

function buildMergedGlossary(settings) {
  const merged = settings.useGlossary ? { ...ECOMMERCE_GLOSSARY } : {};
  const raw = (settings.customGlossary || "").trim();
  if (raw) {
    for (const line of raw.split(/\r?\n/)) {
      const idx = line.indexOf("=");
      if (idx > 0) {
        const k = line.slice(0, idx).trim();
        const v = line.slice(idx + 1).trim();
        if (k && v) merged[k] = v;
      }
    }
  }
  return merged;
}

// 1. 浏览器原生本地离线翻译（Chrome 138+ / Edge 内置 Translator API，免 Key 零延迟）
function detectSimpleSourceLang(sampleText, targetLang) {
  const s = sampleText || "";
  if (/[\u0400-\u04FF]/.test(s)) return "ru";
  if (/[\u3040-\u30FF]/.test(s)) return "ja";
  if (/[\uAC00-\uD7AF]/.test(s)) return "ko";
  if (/[\u4E00-\u9FFF]/.test(s)) return "zh";
  return targetLang.startsWith("en") ? "zh" : "en";
}

function mapLangForBrowser(lang) {
  if (lang === "zh-CN") return "zh";
  if (lang === "zh-TW") return "zh-Hant";
  return lang;
}

const browserTranslatorCache = new Map();

async function translateWithBrowserLocal(texts, targetLang) {
  const TranslatorApi =
    (typeof self !== "undefined" && (self.Translator || self.ai?.translator)) || null;
  if (!TranslatorApi || typeof TranslatorApi.create !== "function") {
    throw new Error("当前浏览器暂不支持内置离线翻译（需 Chrome 138+），请使用 Google 网页或 Pollinations AI");
  }

  const target = mapLangForBrowser(targetLang);
  let source = detectSimpleSourceLang(texts.join(" "), target);

  try {
    const DetectorApi =
      (typeof self !== "undefined" && (self.LanguageDetector || self.ai?.languageDetector)) || null;
    if (DetectorApi && typeof DetectorApi.create === "function") {
      const detector = await DetectorApi.create();
      const detected = await detector.detect(texts.slice(0, 3).join(" "));
      const top = detected?.[0]?.detectedLanguage;
      if (top && top !== "und") source = top;
    }
  } catch {
    // 忽略语种检测异常，沿用字符特征判断
  }

  if (source === target || (source === "zh-Hans" && target === "zh")) {
    return texts.slice();
  }

  const pairKey = `${source}->${target}`;
  let translator = browserTranslatorCache.get(pairKey);
  if (!translator) {
    translator = await TranslatorApi.create({
      sourceLanguage: source,
      targetLanguage: target
    });
    browserTranslatorCache.set(pairKey, translator);
  }

  const out = [];
  for (const t of texts) {
    out.push(await translator.translate(t));
  }
  return out;
}

// 2. Google 免费网页翻译
async function translateWithGoogle(texts, targetLang) {
  const separator = "\n⟪SEP_9X2K⟫\n";
  const joined = texts.join(separator);
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(joined)}`;
  const resp = await fetchWithTimeout(url, {}, 5000);
  if (!resp.ok) throw new Error(`Google translate failed: ${resp.status}`);
  const data = await resp.json();
  const translatedFull = (data[0] || []).map((seg) => seg[0] || "").join("");
  const parts = translatedFull.split(/\s*⟪SEP_9X2K⟫\s*/);
  if (parts.length === texts.length) return parts;

  // 并发逐条兜底（最多 5 并发，避免串行变慢）
  const results = new Array(texts.length);
  for (let i = 0; i < texts.length; i += 5) {
    const slice = texts.slice(i, i + 5);
    const chunk = await Promise.all(
      slice.map(async (t) => {
        const singleUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(t)}`;
        const r = await fetchWithTimeout(singleUrl, {}, 4000);
        const d = await r.json();
        return (d[0] || []).map((s) => s[0] || "").join("") || t;
      })
    );
    chunk.forEach((v, j) => {
      results[i + j] = v;
    });
  }
  return results;
}

// 3. 免费免 Key 开源 AI（Pollinations.ai，GitHub 开源免费推理）
async function translateWithPollinations(texts, settings, glossaryMap) {
  const endpoint = "https://text.pollinations.ai/openai/v1/chat/completions";
  const resp = await fetchWithTimeout(
    endpoint,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai",
        temperature: 0.1,
        messages: [
          { role: "system", content: buildAiPrompt(settings.targetLang, glossaryMap) },
          { role: "user", content: JSON.stringify(texts) }
        ]
      })
    },
    18000
  );
  if (!resp.ok) {
    throw new Error(`Pollinations AI 繁忙 (${resp.status})`);
  }
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content || "";
  return parseJsonArrayOutput(content, texts);
}

// 4. AI 大模型翻译（智谱 GLM / 硅基流动 / DeepSeek / OpenAI 兼容 / Gemini）
function buildAiPrompt(targetLang, glossaryMap) {
  const langName =
    targetLang === "zh-CN" ? "简体中文" : targetLang === "en" ? "English" : targetLang;
  const entries = Object.entries(glossaryMap).slice(0, 24);
  const glossaryText =
    entries.length > 0
      ? `请严格参考术语表：${entries.map(([k, v]) => `${k}=>${v}`).join("；")}。`
      : "";
  return `你是专业网页翻译器。请将输入的 JSON 字符串数组逐项精准翻译为${langName}。${glossaryText}要求：仅返回合法的 JSON 字符串数组，长度与输入完全一致，不要输出任何额外说明或 Markdown 代码块。`;
}

function parseJsonArrayOutput(rawText, fallbackTexts) {
  const cleaned = (rawText || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  // 1. 直接解析
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed) && parsed.length === fallbackTexts.length) {
      return parsed.map((v, i) => (typeof v === "string" ? v : fallbackTexts[i]));
    }
  } catch {
    // 继续尝试提取数组片段
  }

  // 2. 提取首个 [...] JSON 数组（兼容模型前后带说明文字的情况）
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(cleaned.slice(start, end + 1));
      if (Array.isArray(parsed) && parsed.length === fallbackTexts.length) {
        return parsed.map((v, i) => (typeof v === "string" ? v : fallbackTexts[i]));
      }
    } catch {
      // 继续兜底
    }
  }

  // 3. 单条文本兜底（如测试连接或划词单句，模型直接返回纯文本）
  if (fallbackTexts.length === 1 && cleaned.length > 0) {
    return [cleaned.replace(/^["']|["']$/g, "")];
  }

  throw new Error("AI 返回格式无法解析，请检查模型是否支持指令遵循");
}

function formatApiHttpError(prefix, status, errText) {
  if (status === 401) return `${prefix} 鉴权失败 (401)：请检查 API Key 是否正确`;
  if (status === 403) return `${prefix} 无访问权限 (403)：请检查账号额度或地区限制`;
  if (status === 404) return `${prefix} 地址或模型不存在 (404)：请检查 Base URL 和模型名称`;
  if (status === 429) return `${prefix} 请求过于频繁或额度不足 (429)`;
  return `${prefix} 错误 (${status}): ${(errText || "").slice(0, 120)}`;
}

function resolveChatCompletionsUrl(rawBaseUrl) {
  const clean = (rawBaseUrl || "").trim().replace(/\/+$/, "");
  if (!clean) return "https://api.openai.com/v1/chat/completions";
  if (/\/chat\/completions$/i.test(clean)) return clean;
  if (/(\/v\d+|\/openai|\/compatible-mode\/v\d+)$/i.test(clean)) {
    return `${clean}/chat/completions`;
  }
  return `${clean}/v1/chat/completions`;
}

async function translateWithOpenAICompat(texts, settings, glossaryMap) {
  const { apiKey, baseUrl, model } = getActiveAiConfig(settings);
  if (!apiKey) throw new Error("请先在 API 配置页填写 API Key");
  const endpoint = resolveChatCompletionsUrl(baseUrl);
  const resp = await fetchWithTimeout(
    endpoint,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model || "deepseek-chat",
        temperature: 0.1,
        messages: [
          { role: "system", content: buildAiPrompt(settings.targetLang, glossaryMap) },
          { role: "user", content: JSON.stringify(texts) }
        ]
      })
    },
    22000
  );
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(formatApiHttpError("AI API", resp.status, errText));
  }
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content || "";
  return parseJsonArrayOutput(content, texts);
}

async function translateWithGemini(texts, settings, glossaryMap) {
  const { apiKey, model } = getActiveAiConfig(settings);
  if (!apiKey) throw new Error("请先在 API 配置页填写 Gemini API Key");
  const modelName = model || "gemini-2.0-flash";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const resp = await fetchWithTimeout(
    endpoint,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `${buildAiPrompt(settings.targetLang, glossaryMap)}\n\n输入数组：\n${JSON.stringify(texts)}`
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json"
        }
      })
    },
    22000
  );
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(formatApiHttpError("Gemini API", resp.status, errText));
  }
  const data = await resp.json();
  const content = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return parseJsonArrayOutput(content, texts);
}

function makeCacheKey(settings, text) {
  const customHash = (settings.customGlossary || "").length;
  return `${settings.engine}:${settings.targetLang}:${settings.useGlossary ? 1 : 0}:${customHash}:${text}`;
}

async function handleTranslateBatch(texts, options = {}) {
  const { bypassCache = false, bypassGlossary = false, noFallback = false } = options;
  await ensureSessionCacheLoaded();
  const settings = await getSettings();
  const glossaryMap = bypassGlossary ? {} : buildMergedGlossary(settings);

  const results = new Array(texts.length);
  const pendingIndices = [];
  const pendingTexts = [];

  texts.forEach((raw, idx) => {
    const trimmed = raw.trim();
    if (!bypassGlossary && glossaryMap[trimmed]) {
      results[idx] = raw.replace(trimmed, glossaryMap[trimmed]);
      return;
    }
    const ck = makeCacheKey(settings, trimmed);
    if (!bypassCache && globalCache.has(ck)) {
      results[idx] = globalCache.get(ck);
      return;
    }
    pendingIndices.push(idx);
    pendingTexts.push(raw);
  });

  if (pendingTexts.length === 0) {
    return { translations: results, engineUsed: "cache" };
  }

  let translated = null;
  let engineUsed = settings.engine;

  try {
    if (settings.engine === "pollinations") {
      try {
        translated = await translateWithPollinations(pendingTexts, settings, glossaryMap);
      } catch (err) {
        if (noFallback) throw err;
        engineUsed = "google-fallback";
        translated = await translateWithGoogle(pendingTexts, settings.targetLang);
      }
    } else if (settings.engine === "browser") {
      try {
        translated = await translateWithBrowserLocal(pendingTexts, settings.targetLang);
      } catch (err) {
        if (noFallback) throw err;
        try {
          engineUsed = "google-fallback";
          translated = await translateWithGoogle(pendingTexts, settings.targetLang);
        } catch {
          engineUsed = "pollinations-fallback";
          translated = await translateWithPollinations(pendingTexts, settings, glossaryMap);
        }
      }
    } else if (settings.engine === "google" || settings.engine === "edge") {
      try {
        translated = await translateWithGoogle(pendingTexts, settings.targetLang);
      } catch (err) {
        if (noFallback) throw err;
        engineUsed = "pollinations-fallback";
        translated = await translateWithPollinations(pendingTexts, settings, glossaryMap);
      }
    } else if (settings.engine === "gemini") {
      translated = await translateWithGemini(pendingTexts, settings, glossaryMap);
    } else {
      translated = await translateWithOpenAICompat(pendingTexts, settings, glossaryMap);
    }
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error("请求超时，请检查网络连接或接口地址是否可达");
    }
    throw err;
  }

  pendingIndices.forEach((origIdx, i) => {
    const val = translated[i] ?? pendingTexts[i];
    results[origIdx] = val;
    if (!bypassCache) {
      setGlobalCache(makeCacheKey(settings, pendingTexts[i].trim()), val);
    }
  });

  return { translations: results, engineUsed };
}

// ==================== 图片文字识别与翻译（支持免 Key 视觉 AI 与自有视觉大模型） ====================
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function fetchImageAsDataUrl(srcUrl) {
  if (/^data:image\//i.test(srcUrl)) return srcUrl;
  const resp = await fetchWithTimeout(srcUrl, {}, 12000);
  if (!resp.ok) throw new Error(`图片读取失败 (${resp.status})`);
  const contentType = resp.headers.get("content-type") || "image/jpeg";
  const mime = contentType.split(";")[0].trim() || "image/jpeg";
  const buf = await resp.arrayBuffer();
  if (buf.byteLength > 8 * 1024 * 1024) {
    throw new Error("图片体积超过 8MB，建议使用 Alt+I 框选截屏译图");
  }
  return `data:${mime};base64,${arrayBufferToBase64(buf)}`;
}

function buildImagePrompt(targetLang, glossaryMap) {
  const langName =
    targetLang === "zh-CN" ? "简体中文" : targetLang === "en" ? "English" : targetLang;
  const entries = Object.entries(glossaryMap).slice(0, 16);
  const gloss = entries.length
    ? `参考术语：${entries.map(([k, v]) => `${k}=>${v}`).join("；")}。`
    : "";
  return `你是精准的图片文字识别与翻译助手。请从上到下识别图片中的所有可见文字，并将其翻译为自然地道的${langName}。${gloss}
请严格返回合法 JSON，格式如下：
{"items":[{"original":"识别到的原文片段","translated":"对应译文"}]}
要求：
1. 按阅读顺序整理，合并同一行或同一气泡的完整句子；
2. 不要遗漏价格、参数、标签或按钮上的文字；
3. 如果图片中没有文字，返回 {"items":[]}；
4. 只返回 JSON，不要输出任何额外解释或 Markdown 代码块。`;
}

function parseImageJsonResult(rawText) {
  const cleaned = (rawText || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const tryParse = (str) => {
    const obj = JSON.parse(str);
    if (Array.isArray(obj?.items)) {
      return obj.items
        .filter((it) => it && (it.translated || it.original))
        .map((it) => ({
          original: String(it.original || "").trim(),
          translated: String(it.translated || it.original || "").trim()
        }));
    }
    if (Array.isArray(obj)) {
      return obj.map((s) => ({ original: "", translated: String(s || "").trim() })).filter((x) => x.translated);
    }
    return null;
  };

  try {
    const direct = tryParse(cleaned);
    if (direct) return direct;
  } catch {
    // 提取 JSON 对象
  }

  const sIdx = cleaned.indexOf("{");
  const eIdx = cleaned.lastIndexOf("}");
  if (sIdx !== -1 && eIdx > sIdx) {
    try {
      const sub = tryParse(cleaned.slice(sIdx, eIdx + 1));
      if (sub) return sub;
    } catch {
      // 兜底为纯文本
    }
  }

  if (cleaned) {
    return [{ original: "", translated: cleaned }];
  }
  return [];
}

async function translateImageWithGemini(dataUrl, settings, glossaryMap) {
  const { apiKey, model } = getActiveAiConfig(settings);
  if (!apiKey) throw new Error("请先填写 Gemini API Key");
  const match = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/i);
  if (!match) throw new Error("无效的图片数据格式");
  const [, mimeType, base64Data] = match;
  const modelName = model || "gemini-2.0-flash";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const resp = await fetchWithTimeout(
    endpoint,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: buildImagePrompt(settings.targetLang, glossaryMap) },
              { inlineData: { mimeType, data: base64Data } }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json"
        }
      })
    },
    30000
  );
  if (!resp.ok) {
    throw new Error(formatApiHttpError("Gemini 视觉 API", resp.status, await resp.text()));
  }
  const data = await resp.json();
  const content = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return parseImageJsonResult(content);
}

async function translateImageWithOpenAIVision(dataUrl, endpoint, apiKey, model, settings, glossaryMap) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const resp = await fetchWithTimeout(
    endpoint,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        temperature: 0.1,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: buildImagePrompt(settings.targetLang, glossaryMap) },
              { type: "image_url", image_url: { url: dataUrl } }
            ]
          }
        ]
      })
    },
    30000
  );
  if (!resp.ok) {
    throw new Error(formatApiHttpError("视觉翻译接口", resp.status, await resp.text()));
  }
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content || "";
  return parseImageJsonResult(content);
}

async function handleTranslateImage(payload) {
  const settings = await getSettings();
  const glossaryMap = buildMergedGlossary(settings);
  const dataUrl = payload.dataUrl || (await fetchImageAsDataUrl(payload.srcUrl));
  const eng = settings.engine;

  // 1. Gemini 原生多模态
  if (eng === "gemini" && settings.aiProfiles?.gemini?.apiKey) {
    const items = await translateImageWithGemini(dataUrl, settings, glossaryMap);
    return { items, engineUsed: "gemini" };
  }

  // 2. 智谱（自动切免费视觉模型 glm-4v-flash）
  if (eng === "zhipu" && settings.aiProfiles?.zhipu?.apiKey) {
    const prof = settings.aiProfiles.zhipu;
    const visionModel = /v/i.test(prof.model || "") ? prof.model : "glm-4v-flash";
    const items = await translateImageWithOpenAIVision(
      dataUrl,
      resolveChatCompletionsUrl(prof.baseUrl),
      prof.apiKey,
      visionModel,
      settings,
      glossaryMap
    );
    return { items, engineUsed: `zhipu (${visionModel})` };
  }

  // 3. 硅基流动（自动切免费视觉模型 Qwen2.5-VL）
  if (eng === "siliconflow" && settings.aiProfiles?.siliconflow?.apiKey) {
    const prof = settings.aiProfiles.siliconflow;
    const visionModel = /vl|vision/i.test(prof.model || "") ? prof.model : "Qwen/Qwen2.5-VL-7B-Instruct";
    const items = await translateImageWithOpenAIVision(
      dataUrl,
      resolveChatCompletionsUrl(prof.baseUrl),
      prof.apiKey,
      visionModel,
      settings,
      glossaryMap
    );
    return { items, engineUsed: `siliconflow (${visionModel})` };
  }

  // 4. OpenAI / 自定义兼容接口（支持 GPT-4o-mini 等视觉模型）
  if (eng === "openai" && settings.aiProfiles?.openai?.apiKey) {
    const prof = settings.aiProfiles.openai;
    const items = await translateImageWithOpenAIVision(
      dataUrl,
      resolveChatCompletionsUrl(prof.baseUrl),
      prof.apiKey,
      prof.model || "gpt-4o-mini",
      settings,
      glossaryMap
    );
    return { items, engineUsed: prof.model || "openai" };
  }

  // 5. 若其他已配置了视觉 Key（优先智谱 glm-4v-flash / Gemini / OpenAI）
  if (settings.aiProfiles?.zhipu?.apiKey) {
    const prof = settings.aiProfiles.zhipu;
    const items = await translateImageWithOpenAIVision(
      dataUrl,
      resolveChatCompletionsUrl(prof.baseUrl),
      prof.apiKey,
      "glm-4v-flash",
      settings,
      glossaryMap
    );
    return { items, engineUsed: "zhipu (glm-4v-flash)" };
  }
  if (settings.aiProfiles?.gemini?.apiKey) {
    const tempSettings = { ...settings, engine: "gemini" };
    const items = await translateImageWithGemini(dataUrl, tempSettings, glossaryMap);
    return { items, engineUsed: "gemini" };
  }

  // 6. 免 Key 开源视觉 AI 兜底（Pollinations）
  const items = await translateImageWithOpenAIVision(
    dataUrl,
    "https://text.pollinations.ai/openai/v1/chat/completions",
    "",
    "openai",
    settings,
    glossaryMap
  );
  return { items, engineUsed: "pollinations-vision" };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "TRANSLATE_BATCH") {
    handleTranslateBatch(message.texts || [])
      .then((res) => sendResponse({ ok: true, ...res }))
      .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
    return true;
  }

  if (message.type === "TRANSLATE_IMAGE") {
    handleTranslateImage(message)
      .then((res) => sendResponse({ ok: true, ...res }))
      .catch((err) => {
        const msg = err?.name === "AbortError" ? "图片识别超时，建议在配置页填入免费智谱 Key（自动调用 glm-4v-flash）或 Gemini Key" : err.message || String(err);
        sendResponse({ ok: false, error: msg });
      });
    return true;
  }

  if (message.type === "CAPTURE_VISIBLE_TAB") {
    const winId = sender.tab?.windowId;
    chrome.tabs.captureVisibleTab(winId, { format: "jpeg", quality: 88 }, (dataUrl) => {
      if (chrome.runtime.lastError || !dataUrl) {
        sendResponse({ ok: false, error: chrome.runtime.lastError?.message || "截屏失败" });
      } else {
        sendResponse({ ok: true, dataUrl });
      }
    });
    return true;
  }

  if (message.type === "WARMUP") {
    ensureSessionCacheLoaded().catch(() => {});
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "TEST_ENGINE") {
    const start = Date.now();
    handleTranslateBatch(["Hello, DualPage is ready."], {
      bypassCache: true,
      bypassGlossary: true,
      noFallback: true
    })
      .then((res) =>
        sendResponse({
          ok: true,
          sample: res.translations?.[0] || "",
          latencyMs: Date.now() - start,
          engineUsed: res.engineUsed
        })
      )
      .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
    return true;
  }

  if (message.type === "GET_SETTINGS") {
    getSettings()
      .then((settings) => sendResponse({ ok: true, settings }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "SAVE_SETTINGS") {
    getSettings()
      .then(async (current) => {
        const nextProfiles = { ...current.aiProfiles };
        if (message.settings?.aiProfiles) {
          for (const [k, v] of Object.entries(message.settings.aiProfiles)) {
            nextProfiles[k] = { ...(nextProfiles[k] || {}), ...(v || {}) };
          }
        }
        const merged = {
          ...current,
          ...message.settings,
          ai: {
            ...current.ai,
            ...(message.settings?.ai || {})
          },
          aiProfiles: nextProfiles
        };
        // 如果是通过弹窗单框保存 AI，也同步到对应引擎的独立 profile
        const eng = merged.engine;
        if (message.settings?.ai && nextProfiles[eng]) {
          merged.aiProfiles[eng] = { ...nextProfiles[eng], ...message.settings.ai };
        }
        cachedSettings = merged;
        await chrome.storage.sync.set({ settings: merged });
        sendResponse({ ok: true, settings: merged });
      })
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});
