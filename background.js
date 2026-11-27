// 翻译King v2.1 — 高速双引擎后台服务（跨页缓存 + Token 持久化 + 超时自动切换）
const DEFAULT_SETTINGS = {
  engine: "edge", // edge | google | deepseek | openai | gemini
  targetLang: "zh-CN", // zh-CN | en | ru
  displayMode: "replace", // replace | bilingual
  showFloatingBtn: true,
  enableSelectionTranslate: true,
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

// 1. 微软 Edge 免费翻译（并发去重 Token 获取 + Session 持久化）
async function getEdgeToken() {
  await ensureSessionCacheLoaded();
  const now = Date.now();
  if (edgeTokenCache.token && now < edgeTokenCache.expiresAt) {
    return edgeTokenCache.token;
  }
  if (edgeTokenPromise) return edgeTokenPromise;

  edgeTokenPromise = (async () => {
    try {
      const resp = await fetchWithTimeout("https://edge.microsoft.com/translate/auth", {}, 3500);
      if (!resp.ok) throw new Error(`Edge auth failed: ${resp.status}`);
      const token = (await resp.text()).trim();
      edgeTokenCache = { token, expiresAt: Date.now() + 8 * 60 * 1000 };
      chrome.storage.session.set({ lwtEdgeToken: edgeTokenCache }).catch(() => {});
      return token;
    } finally {
      edgeTokenPromise = null;
    }
  })();
  return edgeTokenPromise;
}

function mapLangForEdge(lang) {
  if (lang === "zh-CN") return "zh-Hans";
  if (lang === "zh-TW") return "zh-Hant";
  return lang;
}

async function translateWithEdge(texts, targetLang) {
  const token = await getEdgeToken();
  const to = mapLangForEdge(targetLang);
  const url = `https://api-edge.cognitive.microsofttranslator.com/translate?from=&to=${encodeURIComponent(to)}&api-version=3.0`;
  const resp = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(texts.map((t) => ({ Text: t })))
    },
    5000
  );

  if (!resp.ok) {
    if (resp.status === 401) {
      edgeTokenCache = { token: "", expiresAt: 0 };
      chrome.storage.session.remove("lwtEdgeToken").catch(() => {});
    }
    throw new Error(`Edge translate failed: ${resp.status}`);
  }
  const data = await resp.json();
  return data.map((item, idx) => item?.translations?.[0]?.text || texts[idx]);
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
        engineUsed = "edge-fallback";
        translated = await translateWithEdge(pendingTexts, settings.targetLang);
      }
    } else if (settings.engine === "edge") {
      try {
        translated = await translateWithEdge(pendingTexts, settings.targetLang);
      } catch (err) {
        if (noFallback) throw err;
        engineUsed = "google-fallback";
        translated = await translateWithGoogle(pendingTexts, settings.targetLang);
      }
    } else if (settings.engine === "google") {
      try {
        translated = await translateWithGoogle(pendingTexts, settings.targetLang);
      } catch (err) {
        if (noFallback) throw err;
        engineUsed = "edge-fallback";
        translated = await translateWithEdge(pendingTexts, settings.targetLang);
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "TRANSLATE_BATCH") {
    handleTranslateBatch(message.texts || [])
      .then((res) => sendResponse({ ok: true, ...res }))
      .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
    return true;
  }

  if (message.type === "WARMUP") {
    getSettings().then((s) => {
      if (s.engine === "edge") getEdgeToken().catch(() => {});
    });
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
