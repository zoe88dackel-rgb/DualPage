const toast = document.getElementById("guideToast");
const themeToggleBtn = document.getElementById("themeToggleBtn");
let toastTimer = null;

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  if (themeToggleBtn) {
    themeToggleBtn.textContent = theme === "dark" ? "☀" : "☾";
    themeToggleBtn.title = theme === "dark" ? "切换浅色模式" : "切换深色模式";
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
  toastTimer = setTimeout(() => toast.classList.remove("show"), 1800);
}

document.querySelectorAll("[data-copy]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const val = btn.getAttribute("data-copy");
    if (!val) return;
    navigator.clipboard?.writeText(val).then(() => {
      showCopyToast(`已复制：${val}`);
    });
  });
});

document.querySelector(".brand")?.addEventListener("click", (e) => {
  e.preventDefault();
  window.scrollTo({ top: 0, behavior: "smooth" });
});

// 示例区交互逻辑
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
    titleOrig: "Read foreign pages without losing the original layout.",
    titleTrans: "直接阅读外语网页，不破坏原本的页面排版。",
    paraOrig:
      "Highlight any sentence to translate just that part. You can view a popup with speech, or place the translation right under the paragraph.",
    paraTrans:
      "选中任意一句话就可以只翻这一部分。你可以弹窗查看并朗读，也可以把译文直接排在原段落下面。"
  },
  replace: {
    titleOrig: "直接阅读外语网页，不破坏原本的页面排版。",
    titleTrans: "",
    paraOrig:
      "选中任意一句话就可以只翻这一部分。你可以弹窗查看并朗读，也可以把译文直接排在原段落下面。",
    paraTrans: ""
  },
  original: {
    titleOrig: "Read foreign pages without losing the original layout.",
    titleTrans: "",
    paraOrig:
      "Highlight any sentence to translate just that part. You can view a popup with speech, or place the translation right under the paragraph.",
    paraTrans: ""
  }
};

function renderDemo(mode) {
  currentDemoMode = mode;
  const data = DEMO_DATA[mode] || DEMO_DATA.bilingual;
  sandboxSelBar?.classList.add("hidden");
  sandboxPopupCard?.classList.add("hidden");
  demoPara?.classList.remove("selected");

  demoSwitch?.querySelectorAll(".mode-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.demo === mode);
  });

  if (demoBody) demoBody.classList.add("switching");
  setTimeout(() => {
    if (demoTitle) {
      demoTitle.textContent = data.titleOrig;
      if (data.titleTrans) {
        const s = document.createElement("span");
        s.className = "sample-trans";
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
      dqmModeVal.textContent = mode === "replace" ? "仅译文" : "双语";
    }
    if (demoBody) demoBody.classList.remove("switching");
  }, 110);
}

demoSwitch?.addEventListener("click", (e) => {
  const btn = e.target.closest(".mode-btn");
  if (!btn || btn.classList.contains("active")) return;
  renderDemo(btn.dataset.demo);
});

demoPillMain?.addEventListener("click", () => {
  demoQuickMenu?.classList.add("hidden");
  renderDemo(currentDemoMode === "original" ? "bilingual" : "original");
});

demoPillMore?.addEventListener("click", (e) => {
  e.stopPropagation();
  demoQuickMenu?.classList.toggle("hidden");
});

dqmToggleMode?.addEventListener("click", () => {
  renderDemo(currentDemoMode === "bilingual" ? "replace" : "bilingual");
  demoQuickMenu?.classList.add("hidden");
});

dqmToggleAuto?.addEventListener("click", () => {
  autoSiteEnabled = !autoSiteEnabled;
  if (dqmAutoVal) dqmAutoVal.textContent = autoSiteEnabled ? "开" : "关";
  showCopyToast(autoSiteEnabled ? "已开启自动翻译本站（演示）" : "已关闭自动翻译本站（演示）");
});

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
  showCopyToast("已在该段下方插入译文");
});
