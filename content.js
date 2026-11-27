(() => {
  if (window.__LWT_INITIALIZED__) return;
  window.__LWT_INITIALIZED__ = true;

  const SKIP_TAGS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "OPTION",
    "CODE", "PRE", "SVG", "PATH", "MATH", "CANVAS", "IFRAME", "AUDIO", "VIDEO"
  ]);

  let isActive = false;
  let currentSettings = null;
  let mutationObserver = null;
  let intersectionObserver = null;
  let pendingNodes = new Set();
  let pendingBlocks = new Set();
  let pendingPlaceholders = new Set();
  let observedElements = new WeakSet();
  let flushTimer = null;
  let inFlightBatches = 0;
  let contextDead = false;
  let hasSentFirstBatch = false;
  const MAX_CONCURRENT_BATCHES = 5;

  // 记录原文，便于一键无损还原
  const originalTextMap = new WeakMap();
  const originalPlaceholderMap = new WeakMap();
  const translatedNodes = new Set();
  const translatedBlocks = new Set();
  const translatedPlaceholders = new Set();
  const injectedBilingualEls = new Set();
  const translationCache = new Map();

  function isContextValid() {
    if (contextDead) return false;
    try {
      return typeof chrome !== "undefined" && !!chrome.runtime?.id;
    } catch {
      contextDead = true;
      return false;
    }
  }

  function handleContextInvalidated() {
    if (contextDead) return;
    contextDead = true;
    isActive = false;
    stopObservers();
    pendingNodes.clear();
    pendingPlaceholders.clear();
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (floatingRoot && floatingRoot.isConnected) {
      floatingRoot.remove();
      floatingRoot = null;
    }
    showToast("DualPage 已更新，请刷新当前网页以启用新版");
  }

  async function safeSendMessage(payload) {
    if (!isContextValid()) {
      handleContextInvalidated();
      return null;
    }
    try {
      return await chrome.runtime.sendMessage(payload);
    } catch (err) {
      const msg = String(err?.message || err || "");
      if (msg.includes("Extension context invalidated") || msg.includes("context invalidated")) {
        handleContextInvalidated();
        return null;
      }
      throw err;
    }
  }

  function safeStorageLocalSet(data) {
    if (!isContextValid()) return;
    try {
      chrome.storage.local.set(data, () => {
        void chrome.runtime?.lastError;
      });
    } catch {
      handleContextInvalidated();
    }
  }

  // 清理旧的重复变量声明占位（已移至顶部）

  function shouldTranslateText(text, targetLang) {
    if (!text) return false;
    const trimmed = text.trim();
    if (trimmed.length < 2) return false;
    if (/^[\d\s.,:%+\-–—/\\|()[\]{}<>@#$^&*_=~`'"!?₽€$¥£·•]+$/.test(trimmed)) return false;
    if (/^(https?:\/\/|www\.|[\w.-]+@[\w.-]+\.\w+)/i.test(trimmed)) return false;

    if (targetLang === "zh-CN" || targetLang === "zh-TW") {
      const cjkCount = (trimmed.match(/[\u4e00-\u9fff]/g) || []).length;
      const letterCount = (trimmed.match(/[A-Za-z\u0400-\u04FF\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
      if (cjkCount > 0 && letterCount === 0) return false;
      if (cjkCount / trimmed.length > 0.6 && letterCount < 3) return false;
    }
    return true;
  }

  function isSkippedElement(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return true;
    if (SKIP_TAGS.has(el.tagName)) return true;
    if (el.isContentEditable) return true;
    if (el.closest("#lwt-floating-root, .lwt-bilingual-tag, #lwt-toast, #lwt-selection-chip, #lwt-selection-card, #lwt-img-badge, #lwt-image-card, #lwt-region-overlay")) {
      return true;
    }
    if (el.getAttribute("translate") === "no") return true;
    return false;
  }

  function isElementNearViewport(el) {
    if (!el || typeof el.getBoundingClientRect !== "function") return true;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    return rect.bottom >= -260 && rect.top <= window.innerHeight + 260;
  }

  function collectTextNodes(root) {
    const nodes = [];
    if (!root) return nodes;
    if (root.nodeType === Node.TEXT_NODE) {
      if (root.parentElement && !isSkippedElement(root.parentElement)) {
        nodes.push(root);
      }
      return nodes;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) {
      return nodes;
    }
    if (root.nodeType === Node.ELEMENT_NODE && isSkippedElement(root)) {
      return nodes;
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || isSkippedElement(parent)) return NodeFilter.FILTER_REJECT;
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    let curr;
    while ((curr = walker.nextNode())) {
      nodes.push(curr);
    }
    return nodes;
  }

  function collectPlaceholderInputs(root) {
    if (!root || typeof root.querySelectorAll !== "function") return [];
    return Array.from(root.querySelectorAll("input[placeholder], textarea[placeholder]")).filter(
      (el) => !el.closest("#lwt-floating-root, #lwt-selection-card")
    );
  }

  function getCacheKey(text) {
    const engine = currentSettings?.engine || "edge";
    const lang = currentSettings?.targetLang || "zh-CN";
    const gloss = currentSettings?.useGlossary ? "1" : "0";
    const customLen = (currentSettings?.customGlossary || "").length;
    return `${engine}:${lang}:${gloss}:${customLen}:${text}`;
  }

  const BLOCK_TAGS = new Set([
    "P", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "BLOCKQUOTE",
    "DT", "DD", "FIGCAPTION", "ARTICLE", "SECTION", "TD", "TH", "DIV"
  ]);

  function isCompactInlineContext(parent) {
    if (!parent) return true;
    if (parent.closest("button, a, nav, header, label, summary, [role='button'], [role='tab'], [role='menuitem']")) {
      return true;
    }
    const style = window.getComputedStyle(parent);
    if (
      style.display.includes("flex") ||
      style.display.includes("grid") ||
      style.display.includes("inline") ||
      style.whiteSpace === "nowrap"
    ) {
      return true;
    }
    return !BLOCK_TAGS.has(parent.tagName);
  }

  function applyTranslationToNode(node, translatedText) {
    if (!node || !node.isConnected || !node.parentElement) return;
    const orig = originalTextMap.has(node) ? originalTextMap.get(node) : node.nodeValue;
    if (!originalTextMap.has(node)) originalTextMap.set(node, orig);

    const origTrimmed = orig.trim();
    const transTrimmed = translatedText.trim();

    // 原文与译文完全一致（如品牌名、SKU、FBY）时跳过，避免双语模式下重复堆叠
    if (!transTrimmed || transTrimmed.toLowerCase() === origTrimmed.toLowerCase()) {
      translatedNodes.add(node);
      return;
    }

    const leading = orig.match(/^\s*/)?.[0] || "";
    const trailing = orig.match(/\s*$/)?.[0] || "";
    const formatted = `${leading}${transTrimmed}${trailing}`;

    if (currentSettings?.displayMode === "bilingual") {
      const parent = node.parentElement;
      const useBlock = origTrimmed.length >= 18 && !isCompactInlineContext(parent);
      const className = useBlock ? "lwt-bilingual-tag lwt-bi-block" : "lwt-bilingual-tag lwt-bi-inline";
      const displayText = useBlock ? transTrimmed : ` · ${transTrimmed}`;

      const next = node.nextSibling;
      if (next && next.nodeType === Node.ELEMENT_NODE && next.classList.contains("lwt-bilingual-tag")) {
        next.className = className;
        next.textContent = displayText;
      } else {
        const span = document.createElement("span");
        span.className = className;
        span.textContent = displayText;
        parent.insertBefore(span, node.nextSibling);
        injectedBilingualEls.add(span);
      }
    } else {
      if (node.nodeValue !== formatted) {
        node.nodeValue = formatted;
      }
    }
    translatedNodes.add(node);
  }

  function applyTranslationToPlaceholder(inputEl, translatedText) {
    if (!inputEl || !inputEl.isConnected) return;
    if (!originalPlaceholderMap.has(inputEl)) {
      originalPlaceholderMap.set(inputEl, inputEl.getAttribute("placeholder") || "");
    }
    inputEl.setAttribute("placeholder", translatedText.trim());
    translatedPlaceholders.add(inputEl);
  }

  // 整段双语对照：按完整语义块收集，避免把一句话里的加粗/链接拆碎
  const BLOCK_SELECTOR = "p, h1, h2, h3, h4, h5, h6, li, blockquote, dt, dd, figcaption, td, th, button, a, label, summary, div";
  const NESTED_BLOCK_SELECTOR = "p, h1, h2, h3, h4, h5, h6, li, blockquote, table, ul, ol, section, article, div, nav, header, footer";

  function collectBilingualBlocks(root) {
    const blocks = [];
    if (!root || root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return blocks;
    const scope = root.nodeType === Node.DOCUMENT_NODE ? root.body : root;
    if (!scope) return blocks;

    const candidates = [];
    if (scope.matches && scope.matches(BLOCK_SELECTOR)) candidates.push(scope);
    scope.querySelectorAll(BLOCK_SELECTOR).forEach((el) => candidates.push(el));

    const picked = new Set();
    for (const el of candidates) {
      if (isSkippedElement(el)) continue;
      if (translatedBlocks.has(el)) continue;

      // 如果祖先已经被选中作为整段翻译块，跳过内部子元素（如 p 里的 a / strong）
      let ancestor = el.parentElement;
      let insidePicked = false;
      while (ancestor) {
        if (picked.has(ancestor) || translatedBlocks.has(ancestor)) {
          insidePicked = true;
          break;
        }
        ancestor = ancestor.parentElement;
      }
      if (insidePicked) continue;

      // div / li / td 若内部还包含子块级容器，则跳过外层，交给内层具体段落
      if (el.tagName === "DIV" || el.tagName === "LI" || el.tagName === "TD") {
        if (el.querySelector(NESTED_BLOCK_SELECTOR)) continue;
      }

      const text = getCleanElementText(el);
      if (!text) continue;

      picked.add(el);
      blocks.push(el);
    }
    return blocks;
  }

  function getCleanElementText(el) {
    if (!el) return "";
    // 克隆一份去掉我们自己插入的双语标签，获取纯净整段原文
    const clone = el.cloneNode(true);
    clone.querySelectorAll(".lwt-bilingual-tag, script, style, noscript, svg").forEach((n) => n.remove());
    return (clone.textContent || "").replace(/\s+/g, " ").trim();
  }

  function applyBilingualToBlock(el, translatedText) {
    if (!el || !el.isConnected) return;
    const origTrimmed = getCleanElementText(el);
    const transTrimmed = (translatedText || "").trim();
    if (!transTrimmed || transTrimmed.toLowerCase() === origTrimmed.toLowerCase()) {
      translatedBlocks.add(el);
      return;
    }

    const compact = isCompactInlineContext(el) && origTrimmed.length < 24;
    const className = compact ? "lwt-bilingual-tag lwt-bi-inline" : "lwt-bilingual-tag lwt-bi-block";
    const displayText = compact ? ` (${transTrimmed})` : transTrimmed;

    const existing = el.querySelector(":scope > .lwt-bilingual-tag");
    if (existing) {
      existing.className = className;
      existing.textContent = displayText;
    } else {
      const span = document.createElement("span");
      span.className = className;
      span.textContent = displayText;
      el.appendChild(span);
      injectedBilingualEls.add(span);
    }
    translatedBlocks.add(el);
  }

  function enqueueBlocks(blocks, checkViewport = true) {
    if (!isActive || !currentSettings) return;
    const targetLang = currentSettings.targetLang || "zh-CN";

    for (const el of blocks) {
      if (!el || !el.isConnected || translatedBlocks.has(el)) continue;
      const text = getCleanElementText(el);
      if (!shouldTranslateText(text, targetLang)) continue;

      if (checkViewport && intersectionObserver && !isElementNearViewport(el)) {
        if (!observedElements.has(el)) {
          observedElements.add(el);
          intersectionObserver.observe(el);
        }
        continue;
      }

      const cached = translationCache.get(getCacheKey(text));
      if (cached) {
        applyBilingualToBlock(el, cached);
      } else {
        pendingBlocks.add(el);
      }
    }
    scheduleFlush();
  }

  function scheduleFlush(delay = 35) {
    if ((pendingNodes.size > 0 || pendingBlocks.size > 0 || pendingPlaceholders.size > 0) && !flushTimer) {
      flushTimer = setTimeout(flushPendingQueue, delay);
    }
  }

  function enqueueNodes(nodes, checkViewport = true) {
    if (!isActive || !currentSettings) return;
    const targetLang = currentSettings.targetLang || "zh-CN";

    for (const node of nodes) {
      if (!node || !node.isConnected || translatedNodes.has(node)) continue;
      const raw = node.nodeValue;
      if (!shouldTranslateText(raw, targetLang)) continue;

      const parent = node.parentElement;
      // 视口外的元素交给 IntersectionObserver，滚到附近再翻，首屏秒开
      if (checkViewport && parent && intersectionObserver && !isElementNearViewport(parent)) {
        if (!observedElements.has(parent)) {
          observedElements.add(parent);
          intersectionObserver.observe(parent);
        }
        continue;
      }

      const trimmed = raw.trim();
      const cached = translationCache.get(getCacheKey(trimmed));
      if (cached) {
        applyTranslationToNode(node, cached);
      } else {
        pendingNodes.add(node);
      }
    }
    scheduleFlush();
  }

  function enqueuePlaceholders(inputs) {
    if (!isActive || !currentSettings) return;
    const targetLang = currentSettings.targetLang || "zh-CN";
    for (const el of inputs) {
      if (!el || !el.isConnected || translatedPlaceholders.has(el)) continue;
      const ph = el.getAttribute("placeholder") || "";
      if (!shouldTranslateText(ph, targetLang)) continue;
      const cached = translationCache.get(getCacheKey(ph.trim()));
      if (cached) {
        applyTranslationToPlaceholder(el, cached);
      } else {
        pendingPlaceholders.add(el);
      }
    }
    scheduleFlush();
  }

  async function flushPendingQueue() {
    flushTimer = null;
    if (!isActive || (pendingNodes.size === 0 && pendingBlocks.size === 0 && pendingPlaceholders.size === 0)) return;
    if (inFlightBatches >= MAX_CONCURRENT_BATCHES) return;

    const isTraditionalFree =
      !currentSettings || currentSettings.engine === "edge" || currentSettings.engine === "google";
    const isPollinations = currentSettings?.engine === "pollinations";
    // 首屏第一批采用极速小包（12 条），让可见内容 200ms 内先出字，后续走 5 路并发大包
    const isFirstWave = !hasSentFirstBatch;
    const maxItems = isFirstWave ? 12 : isTraditionalFree ? 55 : isPollinations ? 16 : 22;
    const maxChars = isFirstWave ? 900 : isTraditionalFree ? 4200 : isPollinations ? 1400 : 1800;
    const maxConcurrency = isPollinations ? 2 : MAX_CONCURRENT_BATCHES;

    while (
      inFlightBatches < maxConcurrency &&
      (pendingNodes.size > 0 || pendingBlocks.size > 0 || pendingPlaceholders.size > 0)
    ) {
      const uniqueTexts = [];
      const textToNodes = new Map();
      const textToBlocks = new Map();
      const textToPlaceholders = new Map();
      let totalChars = 0;

      const canAddNewText = (trimmed) =>
        textToNodes.has(trimmed) ||
        textToBlocks.has(trimmed) ||
        textToPlaceholders.has(trimmed) ||
        (uniqueTexts.length < maxItems && totalChars + trimmed.length <= maxChars);

      const registerText = (trimmed) => {
        if (!textToNodes.has(trimmed) && !textToBlocks.has(trimmed) && !textToPlaceholders.has(trimmed)) {
          uniqueTexts.push(trimmed);
          totalChars += trimmed.length;
        }
      };

      for (const el of Array.from(pendingBlocks)) {
        pendingBlocks.delete(el);
        if (!el.isConnected || translatedBlocks.has(el)) continue;
        const trimmed = getCleanElementText(el);
        if (!trimmed) continue;

        const cached = translationCache.get(getCacheKey(trimmed));
        if (cached) {
          applyBilingualToBlock(el, cached);
          continue;
        }
        if (!canAddNewText(trimmed)) {
          pendingBlocks.add(el);
          break;
        }
        registerText(trimmed);
        if (!textToBlocks.has(trimmed)) textToBlocks.set(trimmed, []);
        textToBlocks.get(trimmed).push(el);
      }

      for (const node of Array.from(pendingNodes)) {
        pendingNodes.delete(node);
        if (!node.isConnected || translatedNodes.has(node)) continue;
        const trimmed = (node.nodeValue || "").trim();
        if (!trimmed) continue;

        const cached = translationCache.get(getCacheKey(trimmed));
        if (cached) {
          applyTranslationToNode(node, cached);
          continue;
        }
        if (!canAddNewText(trimmed)) {
          pendingNodes.add(node);
          break;
        }
        registerText(trimmed);
        if (!textToNodes.has(trimmed)) textToNodes.set(trimmed, []);
        textToNodes.get(trimmed).push(node);
      }

      for (const el of Array.from(pendingPlaceholders)) {
        pendingPlaceholders.delete(el);
        if (!el.isConnected || translatedPlaceholders.has(el)) continue;
        const trimmed = (el.getAttribute("placeholder") || "").trim();
        if (!trimmed) continue;

        const cached = translationCache.get(getCacheKey(trimmed));
        if (cached) {
          applyTranslationToPlaceholder(el, cached);
          continue;
        }
        if (!canAddNewText(trimmed)) {
          pendingPlaceholders.add(el);
          break;
        }
        registerText(trimmed);
        if (!textToPlaceholders.has(trimmed)) textToPlaceholders.set(trimmed, []);
        textToPlaceholders.get(trimmed).push(el);
      }

      if (uniqueTexts.length === 0) break;

      hasSentFirstBatch = true;
      dispatchBatch(uniqueTexts, textToNodes, textToBlocks, textToPlaceholders);
    }
  }

  async function dispatchBatch(uniqueTexts, textToNodes, textToBlocks, textToPlaceholders) {
    inFlightBatches++;
    updateFloatingBtnUI();

    try {
      const resp = await safeSendMessage({
        type: "TRANSLATE_BATCH",
        texts: uniqueTexts
      });

      if (!resp) return;
      if (!resp.ok) {
        showToast(resp?.error || "翻译失败，请检查网络或 API 设置", true);
        return;
      }

      if (!isActive) return;

      const translations = resp.translations || [];
      uniqueTexts.forEach((origText, idx) => {
        const trans = translations[idx] || origText;
        translationCache.set(getCacheKey(origText), trans);
        (textToNodes.get(origText) || []).forEach((n) => applyTranslationToNode(n, trans));
        (textToBlocks.get(origText) || []).forEach((b) => applyBilingualToBlock(b, trans));
        (textToPlaceholders.get(origText) || []).forEach((el) => applyTranslationToPlaceholder(el, trans));
      });
    } catch (err) {
      showToast(`翻译异常: ${err.message || err}`, true);
    } finally {
      inFlightBatches = Math.max(0, inFlightBatches - 1);
      updateFloatingBtnUI();
      if (isActive && (pendingNodes.size > 0 || pendingBlocks.size > 0 || pendingPlaceholders.size > 0)) {
        scheduleFlush(10);
      }
    }
  }

  function startObservers() {
    if (!intersectionObserver) {
      intersectionObserver = new IntersectionObserver(
        (entries) => {
          if (!isActive) return;
          const isBilingual = currentSettings?.displayMode === "bilingual";
          const visibleNodes = [];
          const visibleBlocks = [];
          for (const entry of entries) {
            if (entry.isIntersecting) {
              intersectionObserver.unobserve(entry.target);
              if (isBilingual) {
                visibleBlocks.push(entry.target);
              } else {
                visibleNodes.push(...collectTextNodes(entry.target));
              }
            }
          }
          if (visibleBlocks.length > 0) enqueueBlocks(visibleBlocks, false);
          if (visibleNodes.length > 0) enqueueNodes(visibleNodes, false);
        },
        { rootMargin: "600px 0px" }
      );
    }

    if (!mutationObserver) {
      mutationObserver = new MutationObserver((mutations) => {
        if (!isActive) return;
        const isBilingual = currentSettings?.displayMode === "bilingual";
        const freshNodes = [];
        const freshBlocks = [];
        const freshInputs = [];
        for (const m of mutations) {
          if (m.type === "childList") {
            for (const added of m.addedNodes) {
              if (added.nodeType === Node.ELEMENT_NODE) {
                if (isSkippedElement(added)) continue;
                if (isBilingual) {
                  freshBlocks.push(...collectBilingualBlocks(added));
                } else {
                  freshNodes.push(...collectTextNodes(added));
                }
                freshInputs.push(...collectPlaceholderInputs(added));
              } else if (added.nodeType === Node.TEXT_NODE && !isBilingual) {
                freshNodes.push(...collectTextNodes(added));
              }
            }
          } else if (m.type === "characterData" && !isBilingual) {
            const target = m.target;
            if (target.nodeType === Node.TEXT_NODE && !translatedNodes.has(target)) {
              if (target.parentElement && !isSkippedElement(target.parentElement)) {
                freshNodes.push(target);
              }
            }
          }
        }
        if (freshBlocks.length > 0) enqueueBlocks(freshBlocks, true);
        if (freshNodes.length > 0) enqueueNodes(freshNodes, true);
        if (freshInputs.length > 0) enqueuePlaceholders(freshInputs);
      });

      mutationObserver.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }
  }

  function stopObservers() {
    if (mutationObserver) {
      mutationObserver.disconnect();
      mutationObserver = null;
    }
    if (intersectionObserver) {
      intersectionObserver.disconnect();
      intersectionObserver = null;
    }
    observedElements = new WeakSet();
  }

  function restoreOriginalPage() {
    isActive = false;
    stopObservers();
    pendingNodes.clear();
    pendingBlocks.clear();
    pendingPlaceholders.clear();
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }

    for (const node of translatedNodes) {
      if (node.isConnected && originalTextMap.has(node)) {
        node.nodeValue = originalTextMap.get(node);
      }
    }
    translatedNodes.clear();
    translatedBlocks.clear();

    for (const el of translatedPlaceholders) {
      if (el.isConnected && originalPlaceholderMap.has(el)) {
        el.setAttribute("placeholder", originalPlaceholderMap.get(el));
      }
    }
    translatedPlaceholders.clear();

    for (const el of injectedBilingualEls) {
      if (el.isConnected) el.remove();
    }
    injectedBilingualEls.clear();

    updateFloatingBtnUI();
  }

  async function startTranslation(overrideSettings) {
    if (!isContextValid()) {
      handleContextInvalidated();
      return;
    }
    if (overrideSettings) {
      currentSettings = overrideSettings;
    } else {
      const res = await safeSendMessage({ type: "GET_SETTINGS" });
      if (!res) return;
      if (res.ok) currentSettings = res.settings;
    }

    if (isActive) restoreOriginalPage();

    isActive = true;
    hasSentFirstBatch = false;
    updateFloatingBtnUI();
    startObservers();

    if (currentSettings?.displayMode === "bilingual") {
      enqueueBlocks(collectBilingualBlocks(document.body), true);
    } else {
      enqueueNodes(collectTextNodes(document.body), true);
    }
    enqueuePlaceholders(collectPlaceholderInputs(document.body));
  }

  async function toggleTranslation() {
    if (isActive) {
      restoreOriginalPage();
      showToast("已恢复页面原文");
    } else {
      await startTranslation();
      showToast("已开启实时网页翻译 · Alt+T 切换");
    }
  }

  // ==================== iOS 毛玻璃悬浮胶囊 + 快捷菜单 ====================
  let floatingRoot = null;
  let floatingPill = null;
  let floatingBtn = null;
  let floatingLabel = null;
  let menuToggleBtn = null;
  let quickMenu = null;
  let menuOpen = false;

  function clampFloatingPos(left, top) {
    const w = floatingRoot?.offsetWidth || 82;
    const h = floatingRoot?.offsetHeight || 36;
    const margin = 10;
    const maxLeft = Math.max(margin, window.innerWidth - w - margin);
    const maxTop = Math.max(margin, window.innerHeight - h - margin);
    return {
      left: Math.min(Math.max(margin, left), maxLeft),
      top: Math.min(Math.max(margin, top), maxTop)
    };
  }

  function applyFloatingPos(left, top) {
    if (!floatingRoot) return;
    const pos = clampFloatingPos(left, top);
    floatingRoot.style.left = `${pos.left}px`;
    floatingRoot.style.top = `${pos.top}px`;
    floatingRoot.style.right = "auto";
    floatingRoot.style.bottom = "auto";
  }

  function closeQuickMenu() {
    menuOpen = false;
    if (quickMenu) quickMenu.classList.remove("lwt-menu-open");
  }

  function renderQuickMenu() {
    if (!quickMenu || !currentSettings) return;
    const host = window.location.hostname;
    const isAuto = (currentSettings.autoTranslateDomains || []).includes(host);
    const isBilingual = currentSettings.displayMode === "bilingual";

    quickMenu.innerHTML = `
      <button type="button" class="lwt-menu-item" data-act="mode">
        <span>显示模式</span>
        <span class="lwt-menu-val">${isBilingual ? "双语对照" : "仅译文"}</span>
      </button>
      <button type="button" class="lwt-menu-item" data-act="region">
        <span>框选截屏译图</span>
        <span class="lwt-menu-val">Alt+I</span>
      </button>
      <button type="button" class="lwt-menu-item" data-act="auto">
        <span>自动翻译本站</span>
        <span class="lwt-menu-val ${isAuto ? "lwt-on" : ""}">${isAuto ? "已开" : "关闭"}</span>
      </button>
      <button type="button" class="lwt-menu-item lwt-menu-danger" data-act="hide">
        <span>隐藏悬浮球</span>
      </button>
    `;
  }

  function ensureFloatingBtn() {
    if (window.self !== window.top) return;
    if (floatingRoot && floatingRoot.isConnected) return;
    if (!document.body) return;
    // 清理扩展重载后可能残留在页面里的旧悬浮球，保证全页永远只有一个
    document.querySelectorAll("#lwt-floating-root").forEach((el) => el.remove());

    floatingRoot = document.createElement("div");
    floatingRoot.id = "lwt-floating-root";

    quickMenu = document.createElement("div");
    quickMenu.id = "lwt-quick-menu";
    quickMenu.addEventListener("click", async (e) => {
      const item = e.target.closest(".lwt-menu-item");
      if (!item || !currentSettings) return;
      const act = item.dataset.act;
      if (act === "mode") {
        const nextMode = currentSettings.displayMode === "bilingual" ? "replace" : "bilingual";
        const resp = await safeSendMessage({
          type: "SAVE_SETTINGS",
          settings: { displayMode: nextMode }
        });
        if (resp?.ok) {
          currentSettings = resp.settings;
          renderQuickMenu();
          if (isActive) startTranslation(currentSettings);
          showToast(nextMode === "bilingual" ? "已切换为双语对照" : "已切换为仅译文");
        }
      } else if (act === "auto") {
        const host = window.location.hostname;
        const set = new Set(currentSettings.autoTranslateDomains || []);
        const enable = !set.has(host);
        if (enable) set.add(host);
        else set.delete(host);
        const resp = await safeSendMessage({
          type: "SAVE_SETTINGS",
          settings: { autoTranslateDomains: Array.from(set) }
        });
        if (resp?.ok) {
          currentSettings = resp.settings;
          renderQuickMenu();
          showToast(enable ? `已开启自动翻译 ${host}` : "已取消自动翻译本站");
        }
      } else if (act === "region") {
        closeQuickMenu();
        startRegionCapture();
      } else if (act === "hide") {
        closeQuickMenu();
        floatingRoot.style.display = "none";
        showToast("已暂时隐藏悬浮球（可在插件弹窗重新开启）");
      }
    });

    floatingPill = document.createElement("div");
    floatingPill.id = "lwt-floating-pill";

    floatingBtn = document.createElement("button");
    floatingBtn.id = "lwt-floating-btn";
    floatingBtn.type = "button";
    floatingBtn.title = "点击翻译/还原，按住可自由拖动 (Alt+T)";

    const logoWrap = document.createElement("span");
    logoWrap.id = "lwt-floating-logo";
    logoWrap.innerHTML = `<svg viewBox="0 0 100 100" width="14" height="14" aria-hidden="true">
      <g transform="translate(50 50) skewY(-22) translate(-50 -50)">
        <rect x="34" y="42" width="46" height="36" rx="10" fill="none" stroke="#18181A" stroke-width="8"/>
        <rect x="16" y="20" width="48" height="38" rx="10" fill="#18181A"/>
      </g>
    </svg>`;

    floatingLabel = document.createElement("span");
    floatingLabel.id = "lwt-floating-label";
    floatingLabel.textContent = "翻译";

    floatingBtn.appendChild(logoWrap);
    floatingBtn.appendChild(floatingLabel);

    menuToggleBtn = document.createElement("button");
    menuToggleBtn.id = "lwt-floating-more";
    menuToggleBtn.type = "button";
    menuToggleBtn.title = "快捷选项";
    menuToggleBtn.textContent = "⋯";
    menuToggleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      menuOpen = !menuOpen;
      if (menuOpen) {
        renderQuickMenu();
        // 如果靠顶部太近，菜单向下展开
        const rect = floatingRoot.getBoundingClientRect();
        quickMenu.classList.toggle("lwt-menu-below", rect.top < 150);
        quickMenu.classList.toggle("lwt-menu-left", rect.left < 120);
        quickMenu.classList.add("lwt-menu-open");
      } else {
        closeQuickMenu();
      }
    });

    // 拖动与点击区分（支持自动轻吸边）
    let isPointerDown = false;
    let hasDragged = false;
    let startX = 0;
    let startY = 0;
    let origLeft = 0;
    let origTop = 0;

    floatingBtn.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      isPointerDown = true;
      hasDragged = false;
      startX = e.clientX;
      startY = e.clientY;
      const rect = floatingRoot.getBoundingClientRect();
      origLeft = rect.left;
      origTop = rect.top;
      floatingBtn.setPointerCapture(e.pointerId);
    });

    floatingBtn.addEventListener("pointermove", (e) => {
      if (!isPointerDown) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!hasDragged && Math.hypot(dx, dy) > 4) {
        hasDragged = true;
        closeQuickMenu();
        floatingPill.classList.add("lwt-dragging");
      }
      if (hasDragged) {
        applyFloatingPos(origLeft + dx, origTop + dy);
      }
    });

    floatingBtn.addEventListener("pointerup", (e) => {
      if (!isPointerDown) return;
      isPointerDown = false;
      if (floatingBtn.hasPointerCapture(e.pointerId)) {
        floatingBtn.releasePointerCapture(e.pointerId);
      }
      if (hasDragged) {
        floatingPill.classList.remove("lwt-dragging");
        const rect = floatingRoot.getBoundingClientRect();
        let finalLeft = rect.left;
        // 靠左右边缘 26px 内自动优雅吸附停靠
        if (rect.left < 26) finalLeft = 10;
        else if (window.innerWidth - rect.right < 26) finalLeft = window.innerWidth - rect.width - 10;
        applyFloatingPos(finalLeft, rect.top);
        const snapped = floatingRoot.getBoundingClientRect();
        safeStorageLocalSet({
          lwtFloatingPos: { left: Math.round(snapped.left), top: Math.round(snapped.top) }
        });
      } else {
        closeQuickMenu();
        toggleTranslation();
      }
    });

    floatingPill.appendChild(floatingBtn);
    floatingPill.appendChild(menuToggleBtn);
    floatingRoot.appendChild(quickMenu);
    floatingRoot.appendChild(floatingPill);
    document.body.appendChild(floatingRoot);
    updateFloatingBtnUI();

    chrome.storage.local.get("lwtFloatingPos", (res) => {
      if (chrome.runtime.lastError) return;
      const saved = res?.lwtFloatingPos;
      if (saved && typeof saved.left === "number" && typeof saved.top === "number") {
        applyFloatingPos(saved.left, saved.top);
      }
    });

    window.addEventListener("resize", () => {
      if (!floatingRoot || floatingRoot.style.left === "") return;
      const rect = floatingRoot.getBoundingClientRect();
      applyFloatingPos(rect.left, rect.top);
    });
  }

  function updateFloatingBtnUI() {
    if (!floatingRoot || !floatingBtn || !floatingPill) return;
    if (currentSettings && currentSettings.showFloatingBtn === false) {
      floatingRoot.style.display = "none";
      return;
    }
    floatingRoot.style.display = "flex";
    floatingPill.classList.toggle("lwt-active", isActive);
    floatingPill.classList.toggle("lwt-loading", inFlightBatches > 0);

    if (inFlightBatches > 0) {
      if (floatingLabel) floatingLabel.textContent = "翻译中";
    } else if (isActive) {
      if (floatingLabel) floatingLabel.textContent = "原文";
    } else {
      if (floatingLabel) floatingLabel.textContent = "翻译";
    }
  }

  // ==================== 划词即译 & 划词沉浸式对照（双按钮毛玻璃胶囊） ====================
  let selChip = null;
  let selCard = null;
  let lastSelectedText = "";
  let lastSelectionBlock = null;

  function hideSelectionUI() {
    if (selChip) selChip.remove();
    if (selCard) selCard.remove();
    selChip = null;
    selCard = null;
  }

  function findSelectionBlock(range) {
    if (!range) return null;
    let node = range.commonAncestorContainer;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    while (node && node !== document.body && node !== document.documentElement) {
      if (node.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has(node.tagName)) {
        return node;
      }
      node = node.parentElement;
    }
    return range.commonAncestorContainer.nodeType === Node.TEXT_NODE
      ? range.commonAncestorContainer.parentElement
      : range.commonAncestorContainer;
  }

  async function translateSelectionImmersive(blockEl, fallbackText) {
    hideSelectionUI();
    if (!blockEl || !blockEl.isConnected) return;

    // 如果该段落已经做过划词沉浸对照，再次点击则收起还原
    const existing = blockEl.querySelector(":scope > .lwt-bilingual-tag.lwt-sel-immersive");
    if (existing) {
      existing.remove();
      injectedBilingualEls.delete(existing);
      return;
    }

    const fullText = getCleanElementText(blockEl) || fallbackText;
    if (!fullText) return;

    const span = document.createElement("span");
    span.className = "lwt-bilingual-tag lwt-bi-block lwt-sel-immersive";
    span.textContent = "翻译中...";
    span.title = "点击收起此段译文";
    span.addEventListener("click", (e) => {
      e.stopPropagation();
      span.remove();
      injectedBilingualEls.delete(span);
    });
    blockEl.appendChild(span);
    injectedBilingualEls.add(span);

    const cached = translationCache.get(getCacheKey(fullText));
    if (cached) {
      span.textContent = cached;
      return;
    }

    try {
      const resp = await safeSendMessage({
        type: "TRANSLATE_BATCH",
        texts: [fullText]
      });
      if (!span.isConnected) return;
      if (!resp) {
        span.remove();
        return;
      }
      if (resp.ok && resp.translations?.[0]) {
        const trans = resp.translations[0].trim();
        translationCache.set(getCacheKey(fullText), trans);
        span.textContent = trans;
      } else {
        span.remove();
        showToast(resp?.error || "翻译失败", true);
      }
    } catch (err) {
      if (span.isConnected) span.remove();
      showToast(`翻译异常: ${err.message || err}`, true);
    }
  }

  function positionPopupNearRect(el, rect) {
    const w = el.offsetWidth || 260;
    const h = el.offsetHeight || 40;
    let left = rect.left + rect.width / 2 - w / 2;
    let top = rect.top - h - 10;
    if (top < 10) top = rect.bottom + 10;
    left = Math.min(Math.max(10, left), window.innerWidth - w - 10);
    top = Math.min(Math.max(10, top), window.innerHeight - h - 10);
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
  }

  async function openSelectionCard(text, anchorRect) {
    hideSelectionUI();
    selCard = document.createElement("div");
    selCard.id = "lwt-selection-card";
    selCard.innerHTML = `
      <div class="lwt-sc-head">
        <span class="lwt-sc-title">划词翻译</span>
        <div class="lwt-sc-actions">
          <button type="button" class="lwt-sc-btn" data-act="speak" title="朗读原文">朗读</button>
          <button type="button" class="lwt-sc-btn" data-act="copy" title="复制译文">复制</button>
          <button type="button" class="lwt-sc-close" data-act="close">✕</button>
        </div>
      </div>
      <div class="lwt-sc-body">正在翻译...</div>
    `;
    document.body.appendChild(selCard);
    positionPopupNearRect(selCard, anchorRect);

    let translatedResult = "";
    selCard.addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act === "close") {
        hideSelectionUI();
      } else if (act === "copy" && translatedResult) {
        navigator.clipboard?.writeText(translatedResult);
        showToast("译文已复制");
      } else if (act === "speak") {
        if ("speechSynthesis" in window) {
          window.speechSynthesis.cancel();
          const u = new SpeechSynthesisUtterance(text);
          window.speechSynthesis.speak(u);
        }
      }
    });

    const cached = translationCache.get(getCacheKey(text));
    const bodyEl = selCard.querySelector(".lwt-sc-body");
    if (cached) {
      translatedResult = cached;
      bodyEl.textContent = cached;
      positionPopupNearRect(selCard, anchorRect);
      return;
    }

    try {
      const resp = await safeSendMessage({
        type: "TRANSLATE_BATCH",
        texts: [text]
      });
      if (!selCard) return;
      if (!resp) {
        hideSelectionUI();
        return;
      }
      if (resp.ok && resp.translations?.[0]) {
        translatedResult = resp.translations[0];
        translationCache.set(getCacheKey(text), translatedResult);
        bodyEl.textContent = translatedResult;
      } else {
        bodyEl.textContent = resp?.error || "翻译失败";
        bodyEl.classList.add("lwt-sc-err");
      }
      positionPopupNearRect(selCard, anchorRect);
    } catch (err) {
      if (bodyEl) {
        bodyEl.textContent = `翻译失败: ${err.message || err}`;
        bodyEl.classList.add("lwt-sc-err");
      }
    }
  }

  document.addEventListener("mouseup", (e) => {
    if (e.target.closest("#lwt-floating-root, #lwt-selection-chip, #lwt-selection-card")) return;
    closeQuickMenu();

    if (currentSettings && currentSettings.enableSelectionTranslate === false) return;

    setTimeout(() => {
      const sel = window.getSelection();
      const text = (sel?.toString() || "").trim();
      if (!text || text.length < 2 || text.length > 600) {
        hideSelectionUI();
        return;
      }
      const targetLang = currentSettings?.targetLang || "zh-CN";
      if (!shouldTranslateText(text, targetLang)) {
        hideSelectionUI();
        return;
      }
      if (!sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;

      lastSelectedText = text;
      lastSelectionBlock = findSelectionBlock(range);
      hideSelectionUI();

      selChip = document.createElement("div");
      selChip.id = "lwt-selection-chip";
      selChip.innerHTML = `
        <button type="button" class="lwt-chip-btn" data-chip="popup" title="弹窗查看译文（支持复制与朗读）">
          <span class="lwt-chip-logo">
            <svg viewBox="0 0 100 100" width="11" height="11" aria-hidden="true">
              <g transform="translate(50 50) skewY(-22) translate(-50 -50)">
                <rect x="34" y="42" width="46" height="36" rx="10" fill="none" stroke="#18181A" stroke-width="9"/>
                <rect x="16" y="20" width="48" height="38" rx="10" fill="#18181A"/>
              </g>
            </svg>
          </span>
          <span>划词翻译</span>
        </button>
        <button type="button" class="lwt-chip-btn lwt-chip-btn-right" data-chip="immersive" title="直接在该段下方插入沉浸式双语译文">
          <span>沉浸对照</span>
        </button>
      `;

      selChip.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const act = ev.target.closest("[data-chip]")?.dataset.chip;
        if (act === "popup") {
          openSelectionCard(lastSelectedText, rect);
        } else if (act === "immersive") {
          translateSelectionImmersive(lastSelectionBlock, lastSelectedText);
        }
      });

      document.body.appendChild(selChip);
      positionPopupNearRect(selChip, rect);
    }, 20);
  });

  document.addEventListener("mousedown", (e) => {
    if (!e.target.closest("#lwt-selection-chip, #lwt-selection-card")) {
      hideSelectionUI();
    }
    if (!e.target.closest("#lwt-floating-root")) {
      closeQuickMenu();
    }
  });

  // ==================== 图片悬停「译图」+ 框选截屏译图 (Alt+I) + 清晰结果卡片 ====================
  let imgBadge = null;
  let hoveredImg = null;
  let imgBadgeHideTimer = null;
  let imgCard = null;
  let regionOverlay = null;

  function hideImgBadge() {
    if (imgBadge) imgBadge.style.display = "none";
    hoveredImg = null;
  }

  function ensureImgBadge() {
    if (imgBadge || window.self !== window.top) return;
    imgBadge = document.createElement("button");
    imgBadge.id = "lwt-img-badge";
    imgBadge.type = "button";
    imgBadge.textContent = "译图";
    imgBadge.title = "点击识别并翻译图片中的文字";
    imgBadge.style.display = "none";
    imgBadge.addEventListener("mouseenter", () => clearTimeout(imgBadgeHideTimer));
    imgBadge.addEventListener("mouseleave", () => {
      imgBadgeHideTimer = setTimeout(hideImgBadge, 220);
    });
    imgBadge.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!hoveredImg) return;
      const targetImg = hoveredImg;
      const rect = targetImg.getBoundingClientRect();
      hideImgBadge();
      translateImageElement(targetImg, rect);
    });
    document.body.appendChild(imgBadge);
  }

  document.addEventListener("mouseover", (e) => {
    if (window.self !== window.top) return;
    if (currentSettings && currentSettings.enableImageTranslate === false) return;
    const img = e.target?.closest?.("img");
    if (!img || img.closest("#lwt-floating-root, #lwt-image-card, #lwt-selection-card")) return;
    const rect = img.getBoundingClientRect();
    if (rect.width < 140 || rect.height < 90) return;

    clearTimeout(imgBadgeHideTimer);
    ensureImgBadge();
    hoveredImg = img;
    const top = Math.max(8, rect.top + 8);
    const left = Math.min(window.innerWidth - 62, Math.max(8, rect.right - 56));
    imgBadge.style.top = `${Math.round(top)}px`;
    imgBadge.style.left = `${Math.round(left)}px`;
    imgBadge.style.display = "inline-flex";
  });

  document.addEventListener("mouseout", (e) => {
    if (!hoveredImg) return;
    const rel = e.relatedTarget;
    if (rel === imgBadge || rel === hoveredImg) return;
    if (e.target === hoveredImg) {
      imgBadgeHideTimer = setTimeout(hideImgBadge, 240);
    }
  });

  function closeImageCard() {
    if (imgCard) imgCard.remove();
    imgCard = null;
  }

  async function openImageTranslationCard(payload, anchorRect) {
    closeImageCard();
    imgCard = document.createElement("div");
    imgCard.id = "lwt-image-card";
    imgCard.innerHTML = `
      <div class="lwt-ic-head">
        <span class="lwt-ic-title">图片文字翻译</span>
        <div class="lwt-ic-actions">
          <button type="button" class="lwt-sc-btn" data-ic="mode">仅译文</button>
          <button type="button" class="lwt-sc-btn" data-ic="copy">复制</button>
          <button type="button" class="lwt-sc-close" data-ic="close">✕</button>
        </div>
      </div>
      <div class="lwt-ic-body">
        <div class="lwt-ic-loading">正在识别图片文字并翻译...</div>
      </div>
    `;
    document.body.appendChild(imgCard);

    if (anchorRect) {
      positionPopupNearRect(imgCard, anchorRect);
    } else {
      imgCard.style.left = `${Math.max(16, Math.round((window.innerWidth - 360) / 2))}px`;
      imgCard.style.top = "72px";
    }

    let items = [];
    let showOriginal = true;
    const bodyEl = imgCard.querySelector(".lwt-ic-body");
    const modeBtn = imgCard.querySelector('[data-ic="mode"]');

    function renderItems() {
      if (!bodyEl) return;
      if (items.length === 0) {
        bodyEl.innerHTML = `<div class="lwt-ic-empty">未在图片中识别到可翻译文字</div>`;
        return;
      }
      bodyEl.innerHTML = "";
      items.forEach((it) => {
        const row = document.createElement("div");
        row.className = "lwt-ic-row";
        if (showOriginal && it.original && it.original !== it.translated) {
          const origEl = document.createElement("div");
          origEl.className = "lwt-ic-orig";
          origEl.textContent = it.original;
          row.appendChild(origEl);
        }
        const transEl = document.createElement("div");
        transEl.className = "lwt-ic-trans";
        transEl.textContent = it.translated;
        row.appendChild(transEl);
        bodyEl.appendChild(row);
      });
    }

    imgCard.addEventListener("click", (e) => {
      const act = e.target.closest("[data-ic]")?.dataset.ic;
      if (act === "close") {
        closeImageCard();
      } else if (act === "mode") {
        showOriginal = !showOriginal;
        if (modeBtn) modeBtn.textContent = showOriginal ? "仅译文" : "双语";
        renderItems();
      } else if (act === "copy" && items.length > 0) {
        const txt = items.map((i) => i.translated).join("\n");
        navigator.clipboard?.writeText(txt);
        showToast("图片译文已复制");
      }
    });

    try {
      const resp = await safeSendMessage({ type: "TRANSLATE_IMAGE", ...payload });
      if (!imgCard) return;
      if (!resp) {
        closeImageCard();
        return;
      }
      if (!resp.ok) {
        bodyEl.innerHTML = `<div class="lwt-sc-err"></div>`;
        bodyEl.querySelector(".lwt-sc-err").textContent = resp.error || "图片翻译失败";
        return;
      }
      items = resp.items || [];
      renderItems();
      if (anchorRect) positionPopupNearRect(imgCard, anchorRect);
    } catch (err) {
      if (bodyEl) {
        bodyEl.innerHTML = `<div class="lwt-sc-err"></div>`;
        bodyEl.querySelector(".lwt-sc-err").textContent = `图片翻译异常: ${err.message || err}`;
      }
    }
  }

  function translateImageElement(imgEl, rect) {
    const srcUrl = imgEl.currentSrc || imgEl.src;
    if (!srcUrl) {
      showToast("无法读取该图片地址，请用 Alt+I 框选截屏译图", true);
      return;
    }
    openImageTranslationCard({ srcUrl }, rect);
  }

  function stopRegionCapture() {
    if (regionOverlay) regionOverlay.remove();
    regionOverlay = null;
  }

  function startRegionCapture() {
    if (window.self !== window.top) return;
    stopRegionCapture();
    hideImgBadge();
    hideSelectionUI();

    regionOverlay = document.createElement("div");
    regionOverlay.id = "lwt-region-overlay";
    const hint = document.createElement("div");
    hint.id = "lwt-region-hint";
    hint.textContent = "拖动鼠标框选需要翻译的图片区域 · 按 Esc 取消";
    const box = document.createElement("div");
    box.id = "lwt-region-box";
    regionOverlay.appendChild(hint);
    regionOverlay.appendChild(box);
    document.body.appendChild(regionOverlay);

    let sx = 0;
    let sy = 0;
    let dragging = false;

    regionOverlay.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      dragging = true;
      sx = e.clientX;
      sy = e.clientY;
      box.style.display = "block";
      box.style.left = `${sx}px`;
      box.style.top = `${sy}px`;
      box.style.width = "0px";
      box.style.height = "0px";
    });

    regionOverlay.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const x = Math.min(sx, e.clientX);
      const y = Math.min(sy, e.clientY);
      const w = Math.abs(e.clientX - sx);
      const h = Math.abs(e.clientY - sy);
      box.style.left = `${x}px`;
      box.style.top = `${y}px`;
      box.style.width = `${w}px`;
      box.style.height = `${h}px`;
    });

    regionOverlay.addEventListener("mouseup", async (e) => {
      if (!dragging) return;
      dragging = false;
      const x = Math.min(sx, e.clientX);
      const y = Math.min(sy, e.clientY);
      const w = Math.abs(e.clientX - sx);
      const h = Math.abs(e.clientY - sy);
      stopRegionCapture();

      if (w < 20 || h < 20) return;

      // 等待一帧让遮罩彻底消失后再截屏
      await new Promise((r) => setTimeout(r, 60));
      const cap = await safeSendMessage({ type: "CAPTURE_VISIBLE_TAB" });
      if (!cap || !cap.ok || !cap.dataUrl) {
        showToast(cap?.error || "截屏失败", true);
        return;
      }

      const dpr = window.devicePixelRatio || 1;
      const img = new Image();
      img.onload = () => {
        const maxSide = 1280;
        const srcW = Math.round(w * dpr);
        const srcH = Math.round(h * dpr);
        const scale = Math.min(1, maxSide / Math.max(srcW, srcH));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(srcW * scale));
        canvas.height = Math.max(1, Math.round(srcH * scale));
        const ctx = canvas.getContext("2d");
        ctx.drawImage(
          img,
          Math.round(x * dpr),
          Math.round(y * dpr),
          srcW,
          srcH,
          0,
          0,
          canvas.width,
          canvas.height
        );
        const croppedDataUrl = canvas.toDataURL("image/jpeg", 0.88);
        openImageTranslationCard(
          { dataUrl: croppedDataUrl },
          { left: x, top: y, right: x + w, bottom: y + h, width: w, height: h }
        );
      };
      img.src = cap.dataUrl;
    });
  }

  // ==================== 灵动岛轻提示 ====================
  let toastTimer = null;
  function showToast(msg, isError = false) {
    let toast = document.getElementById("lwt-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "lwt-toast";
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.className = isError ? "lwt-toast-error lwt-toast-show" : "lwt-toast-show";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove("lwt-toast-show");
    }, 2600);
  }

  // 快捷键：Alt+T 开关全页翻译，Alt+I 框选截屏译图，Esc 关闭弹窗与遮罩
  window.addEventListener("keydown", (e) => {
    if (e.altKey && (e.key === "t" || e.key === "T")) {
      e.preventDefault();
      toggleTranslation();
    } else if (e.altKey && (e.key === "i" || e.key === "I")) {
      e.preventDefault();
      startRegionCapture();
    } else if (e.key === "Escape") {
      hideSelectionUI();
      closeQuickMenu();
      closeImageCard();
      stopRegionCapture();
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "GET_PAGE_STATE") {
      sendResponse({ ok: true, isActive, hostname: window.location.hostname });
      return true;
    }
    if (message.type === "TOGGLE_TRANSLATE") {
      toggleTranslation().then(() => sendResponse({ ok: true, isActive }));
      return true;
    }
    if (message.type === "TRANSLATE_SELECTION_FROM_MENU") {
      const txt = (message.text || "").trim();
      if (txt) {
        openSelectionCard(txt, {
          left: window.innerWidth / 2 - 140,
          top: 90,
          right: window.innerWidth / 2 + 140,
          bottom: 120,
          width: 280,
          height: 30
        });
      }
      sendResponse({ ok: true });
      return true;
    }
    if (message.type === "TRANSLATE_IMAGE_URL") {
      if (message.srcUrl) {
        openImageTranslationCard({ srcUrl: message.srcUrl }, null);
      }
      sendResponse({ ok: true });
      return true;
    }
    if (message.type === "START_REGION_CAPTURE") {
      startRegionCapture();
      sendResponse({ ok: true });
      return true;
    }
    if (message.type === "APPLY_SETTINGS_AND_RETRANSLATE") {
      currentSettings = message.settings;
      updateFloatingBtnUI();
      if (isActive) {
        startTranslation(message.settings).then(() => sendResponse({ ok: true, isActive }));
      } else {
        sendResponse({ ok: true, isActive });
      }
      return true;
    }
  });

  chrome.runtime.sendMessage({ type: "GET_SETTINGS" }, (res) => {
    if (chrome.runtime.lastError || !res?.ok) return;
    currentSettings = res.settings;
    ensureFloatingBtn();
    chrome.runtime.sendMessage({ type: "WARMUP" });

    const host = window.location.hostname;
    const autoList = currentSettings.autoTranslateDomains || [];
    if (host && autoList.includes(host)) {
      startTranslation(currentSettings);
    }
  });
})();
