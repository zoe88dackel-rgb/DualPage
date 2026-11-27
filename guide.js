const toast = document.getElementById("guideToast");
const scrollProgress = document.getElementById("scrollProgress");
const themeToggleBtn = document.getElementById("themeToggleBtn");
let toastTimer = null;

// 深浅色模式手动切换 + 跨页记忆
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  if (themeToggleBtn) {
    themeToggleBtn.textContent = theme === "dark" ? "☀" : "☾";
    themeToggleBtn.title = theme === "dark" ? "切换为浅色模式" : "切换为深色模式";
  }
}

function initTheme() {
  const saved = localStorage.getItem("dualpage_theme");
  const initial =
    saved === "dark" || saved === "light"
      ? saved
      : window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  applyTheme(initial);
}

themeToggleBtn?.addEventListener("click", () => {
  const curr = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  const next = curr === "dark" ? "light" : "dark";
  localStorage.setItem("dualpage_theme", next);
  applyTheme(next);
});

initTheme();

function showCopyToast(msg) {
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 1800);
}

// 一键复制按钮
document.querySelectorAll("[data-copy]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const val = btn.getAttribute("data-copy");
    if (!val) return;
    navigator.clipboard?.writeText(val).then(() => {
      showCopyToast(`已复制：${val}`);
    });
  });
});

// 点击左上角 Logo 平滑回到页面顶部
document.querySelector(".brand")?.addEventListener("click", (e) => {
  e.preventDefault();
  window.scrollTo({ top: 0, behavior: "smooth" });
});

// 顶部极细滚动进度条
window.addEventListener(
  "scroll",
  () => {
    if (!scrollProgress) return;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const pct = max > 0 ? Math.min(100, Math.max(0, (window.scrollY / max) * 100)) : 0;
    scrollProgress.style.width = `${pct}%`;
  },
  { passive: true }
);

// Apple 风格滚动逐级浮现（Scroll Reveal）
const revealTargets = document.querySelectorAll(
  ".brand-story, .sec-head, .bento-card, .step-card, .spec-list, .release-card"
);

revealTargets.forEach((el) => {
  el.classList.add("reveal");
  // 同容器内卡片做微妙的错峰延迟
  const siblings = el.parentElement ? Array.from(el.parentElement.children) : [];
  const idx = siblings.indexOf(el);
  if (idx > 0 && idx < 6 && (el.classList.contains("bento-card") || el.classList.contains("step-card"))) {
    el.style.transitionDelay = `${idx * 70}ms`;
  }
});

if ("IntersectionObserver" in window) {
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
  );
  revealTargets.forEach((el) => io.observe(el));
} else {
  revealTargets.forEach((el) => el.classList.add("is-visible"));
}

// Hero 区交互式双语/仅译文/原文预览切换（带丝滑淡入淡出）
const demoSwitch = document.getElementById("demoSwitch");
const demoBody = document.getElementById("demoBody");
const demoTitle = document.getElementById("demoTitle");
const demoText = document.getElementById("demoText");
const demoPill = document.getElementById("demoPill");
const demoPillText = document.getElementById("demoPillText");
let currentDemoMode = "bilingual";

const DEMO_CONTENT = {
  bilingual: {
    titleOrig: "Read the web in any language, effortlessly.",
    titleTrans: "轻松无障碍地阅读任意语言的网页内容。",
    textOrig:
      "DualPage translates entire paragraphs naturally without breaking layouts or interrupting your flow. Switch between bilingual reading, clean translation, or original text in a single click.",
    textTrans:
      "DualPage 以自然的方式整段翻译网页内容，不破坏页面排版，也不打断阅读心流。只需轻点一下，即可在双语对照、纯译文与原文之间自由切换。"
  },
  replace: {
    titleOrig: "轻松无障碍地阅读任意语言的网页内容。",
    titleTrans: "",
    textOrig:
      "DualPage 以自然的方式整段翻译网页内容，不破坏页面排版，也不打断阅读心流。只需轻点一下，即可在双语对照、纯译文与原文之间自由切换。",
    textTrans: ""
  },
  original: {
    titleOrig: "Read the web in any language, effortlessly.",
    titleTrans: "",
    textOrig:
      "DualPage translates entire paragraphs naturally without breaking layouts or interrupting your flow. Switch between bilingual reading, clean translation, or original text in a single click.",
    textTrans: ""
  }
};

function renderDemo(mode) {
  currentDemoMode = mode;
  const data = DEMO_CONTENT[mode] || DEMO_CONTENT.bilingual;
  if (demoBody) demoBody.classList.add("switching");
  setTimeout(() => {
    if (demoTitle) {
      demoTitle.textContent = data.titleOrig;
      if (data.titleTrans) {
        const s = document.createElement("span");
        s.className = "demo-trans";
        s.textContent = data.titleTrans;
        demoTitle.appendChild(s);
      }
    }
    if (demoText) {
      demoText.textContent = data.textOrig;
      if (data.textTrans) {
        const s = document.createElement("span");
        s.className = "demo-trans";
        s.textContent = data.textTrans;
        demoText.appendChild(s);
      }
    }
    if (demoPill && demoPillText) {
      const isOrig = mode === "original";
      demoPill.classList.toggle("is-orig", isOrig);
      demoPillText.textContent = isOrig ? "翻译" : "原文";
    }
    if (demoBody) demoBody.classList.remove("switching");
  }, 150);
}

demoSwitch?.addEventListener("click", (e) => {
  const btn = e.target.closest(".demo-mode-btn");
  if (!btn || btn.classList.contains("active")) return;
  demoSwitch.querySelectorAll(".demo-mode-btn").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  renderDemo(btn.dataset.demo);
});

demoPill?.addEventListener("click", () => {
  const next = currentDemoMode === "original" ? "bilingual" : "original";
  demoSwitch?.querySelectorAll(".demo-mode-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.demo === next);
  });
  renderDemo(next);
});
