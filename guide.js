const toast = document.getElementById("guideToast");
const themeToggleBtn = document.getElementById("themeToggleBtn");
let toastTimer = null;

// 深浅色主题切换与本地记忆
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

function showCopyToast(msg) {
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 1900);
}

// 一键复制
document.querySelectorAll("[data-copy]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const val = btn.getAttribute("data-copy");
    if (!val) return;
    navigator.clipboard?.writeText(val).then(() => {
      showCopyToast(`已复制：${val}`);
    });
  });
});

// 点击左上角品牌回到顶部
document.querySelector(".brand")?.addEventListener("click", (e) => {
  e.preventDefault();
  window.scrollTo({ top: 0, behavior: "smooth" });
});

// IntersectionObserver 驱动滚动渐入（零 scroll 事件监听，流畅不掉帧）
const revealTargets = document.querySelectorAll(
  ".sec-header, .workflow-layout, .bento-cell, .panel-card, .faq-box, .release-box"
);

revealTargets.forEach((el) => {
  el.classList.add("reveal");
  if (el.classList.contains("bento-cell")) {
    const siblings = el.parentElement ? Array.from(el.parentElement.children) : [];
    const idx = siblings.indexOf(el);
    if (idx > 0) el.style.transitionDelay = `${idx * 55}ms`;
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
    { threshold: 0.1, rootMargin: "0px 0px -32px 0px" }
  );
  revealTargets.forEach((el) => io.observe(el));
} else {
  revealTargets.forEach((el) => el.classList.add("is-visible"));
}

// ==================== 首屏交互式沙盒逻辑 ====================
const demoSwitch = document.getElementById("demoSwitch");
const demoBody = document.getElementById("demoBody");
const demoTitle = document.getElementById("demoTitle");
const demoPara = document.getElementById("demoPara");
const demoParaOrig = document.getElementById("demoParaOrig");
const demoParaTrans = document.getElementById("demoParaTrans");
const sandboxSelBar = document.getElementById("sandboxSelBar");
const sandboxPopupCard = document.getElementById("sandboxPopupCard");
const sbPopupBtn = document.getElementById("sbPopupBtn");
const sbImmersiveBtn = document.getElementById("sbImmersiveBtn");
const demoPill = document.getElementById("demoPill");
const demoPillMain = document.getElementById("demoPillMain");
const demoPillMore = document.getElementById("demoPillMore");
const demoPillText = document.getElementById("demoPillText");
const demoQuickMenu = document.getElementById("demoQuickMenu");
const dqmToggleMode = document.getElementById("dqmToggleMode");
const dqmModeVal = document.getElementById("dqmModeVal");
const dqmToggleAuto = document.getElementById("dqmToggleAuto");
const dqmAutoVal = document.getElementById("dqmAutoVal");

let currentDemoMode = "bilingual";
let autoSiteEnabled = true;

const DEMO_DATA = {
  bilingual: {
    titleOrig: "Great tools stay out of your way until you need them.",
    titleTrans: "真正好用的工具平时毫不打扰，只在你需要时恰到好处地出现。",
    paraOrig:
      "Select any sentence on a foreign page to reveal a compact action bar. You can check a quick popup card with pronunciation, or insert a clean bilingual translation right underneath that single paragraph.",
    paraTrans:
      "在外语网页上选中任意一句话，就会弹出轻巧的双按钮操作条。你可以弹窗查看译文并朗读，也可以只把这一段原位展开双语对照。"
  },
  replace: {
    titleOrig: "真正好用的工具平时毫不打扰，只在你需要时恰到好处地出现。",
    titleTrans: "",
    paraOrig:
      "在外语网页上选中任意一句话，就会弹出轻巧的双按钮操作条。你可以弹窗查看译文并朗读，也可以只把这一段原位展开双语对照。",
    paraTrans: ""
  },
  original: {
    titleOrig: "Great tools stay out of your way until you need them.",
    titleTrans: "",
    paraOrig:
      "Select any sentence on a foreign page to reveal a compact action bar. You can check a quick popup card with pronunciation, or insert a clean bilingual translation right underneath that single paragraph.",
    paraTrans: ""
  }
};

function renderDemo(mode) {
  currentDemoMode = mode;
  const data = DEMO_DATA[mode] || DEMO_DATA.bilingual;
  sandboxSelBar?.classList.add("hidden");
  sandboxPopupCard?.classList.add("hidden");
  demoPara?.classList.remove("selected");

  demoSwitch?.querySelectorAll(".seg-item").forEach((b) => {
    b.classList.toggle("active", b.dataset.demo === mode);
  });

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
    if (demoParaOrig) demoParaOrig.textContent = data.paraOrig;
    if (demoParaTrans) {
      demoParaTrans.textContent = data.paraTrans;
      demoParaTrans.style.display = data.paraTrans ? "block" : "none";
    }
    if (demoPill && demoPillText) {
      const isOrig = mode === "original";
      demoPill.classList.toggle("is-orig", isOrig);
      demoPillText.textContent = isOrig ? "翻译" : "原文";
    }
    if (dqmModeVal) {
      dqmModeVal.textContent = mode === "replace" ? "仅译文" : "双语对照";
    }
    if (demoBody) demoBody.classList.remove("switching");
  }, 130);
}

demoSwitch?.addEventListener("click", (e) => {
  const btn = e.target.closest(".seg-item");
  if (!btn || btn.classList.contains("active")) return;
  renderDemo(btn.dataset.demo);
});

demoPillMain?.addEventListener("click", () => {
  demoQuickMenu?.classList.add("hidden");
  const next = currentDemoMode === "original" ? "bilingual" : "original";
  renderDemo(next);
});

demoPillMore?.addEventListener("click", (e) => {
  e.stopPropagation();
  demoQuickMenu?.classList.toggle("hidden");
});

dqmToggleMode?.addEventListener("click", () => {
  const next = currentDemoMode === "bilingual" ? "replace" : "bilingual";
  renderDemo(next);
  demoQuickMenu?.classList.add("hidden");
});

dqmToggleAuto?.addEventListener("click", () => {
  autoSiteEnabled = !autoSiteEnabled;
  if (dqmAutoVal) dqmAutoVal.textContent = autoSiteEnabled ? "已开启" : "已关闭";
  showCopyToast(autoSiteEnabled ? "演示：已开启自动翻译本站" : "演示：已关闭自动翻译本站");
});

// 点击段落模拟划词弹出双按钮条
demoPara?.addEventListener("click", () => {
  demoQuickMenu?.classList.add("hidden");
  const willSelect = !demoPara.classList.contains("selected");
  demoPara.classList.toggle("selected", willSelect);
  sandboxSelBar?.classList.toggle("hidden", !willSelect);
  if (!willSelect) sandboxPopupCard?.classList.add("hidden");
});

sbPopupBtn?.addEventListener("click", () => {
  sandboxPopupCard?.classList.remove("hidden");
});

sbImmersiveBtn?.addEventListener("click", () => {
  sandboxPopupCard?.classList.add("hidden");
  sandboxSelBar?.classList.add("hidden");
  demoPara?.classList.remove("selected");
  if (demoParaTrans) {
    demoParaTrans.textContent = DEMO_DATA.bilingual.paraTrans;
    demoParaTrans.style.display = "block";
  }
  showCopyToast("已在该段下方插入沉浸双语对照");
});

// ==================== 新手三招交互选项卡 ====================
const wfTabs = document.getElementById("wfTabs");
const wfStageTag = document.getElementById("wfStageTag");
const wfOrig = document.getElementById("wfOrig");
const wfTrans = document.getElementById("wfTrans");
const wfTip = document.getElementById("wfTip");

const WF_SCENES = {
  page: {
    tag: "场景演示：整页无感双语对照",
    orig: "Orders shipped from local fulfillment centers receive priority placement in search results.",
    trans: "从本地履约中心发货的订单将在搜索结果中获得优先展示权重。",
    tip: "没有刺眼的蓝色竖线与底色框，译文自然融入原网页字号与配色，按钮和导航栏也不会变形。"
  },
  select: {
    tag: "场景演示：鼠标划选单句 -> 点「沉浸对照」",
    orig: "Your custom glossary and API keys stay strictly inside local browser storage.",
    trans: "[划词原位展开] 你的自定义术语表与 API 密钥严格保存在本机浏览器存储中（再次点击本段即可收起）。",
    tip: "阅读英文文档大部分都能看懂、只有一两句长难句拿不准时，用划词沉浸对照最舒服。"
  },
  auto: {
    tag: "场景演示：白名单站点打开即中文",
    orig: "已为常用外语工作台开启「始终自动翻译当前网站」",
    trans: "利用 5,000 条本地持久化缓存，侧边栏菜单、表头与状态标签切页 0ms 直接显示中文。",
    tip: "随时可在悬浮球菜单或配置中心增删自动翻译白名单域名。"
  }
};

wfTabs?.addEventListener("click", (e) => {
  const tab = e.target.closest(".wf-tab");
  if (!tab) return;
  const key = tab.dataset.wf;
  const scene = WF_SCENES[key];
  if (!scene) return;

  wfTabs.querySelectorAll(".wf-tab").forEach((t) => t.classList.toggle("active", t === tab));
  if (wfStageTag) wfStageTag.textContent = scene.tag;
  if (wfOrig) wfOrig.textContent = scene.orig;
  if (wfTrans) wfTrans.textContent = scene.trans;
  if (wfTip) wfTip.textContent = scene.tip;
});
