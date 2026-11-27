<p align="center">
  <img src="icons/logo256.png" width="88" height="88" alt="DualPage Logo" />
</p>

<h1 align="center">DualPage</h1>

<p align="center">
  <strong>双面阅读，如原生般自然。</strong><br/>
  轻量（~68 KB）、零服务器隐私、极简风格的全网页与图片实时双语翻译浏览器扩展
</p>

<p align="center">
  <a href="https://github.com/zoe88dackel-rgb/DualPage/releases/latest/download/DualPage-latest.zip">
    <img src="https://img.shields.io/badge/一键下载最新安装包-v2.3.1%20ZIP-0071E3?style=for-the-badge&logo=github" alt="一键下载 DualPage 最新安装包" />
  </a>
  <a href="https://github.com/zoe88dackel-rgb/DualPage/releases/latest">
    <img src="https://img.shields.io/badge/查看历史版本-Releases-1D1D1F?style=for-the-badge" alt="查看 Releases" />
  </a>
</p>

---

## 核心卖点

- **真正零服务器（Zero-Server Privacy）**：无账号、无后端、无追踪、无会员锁；你的 API Key 与自定义术语表仅保存在本机浏览器中。
- **首屏极速秒翻**：首屏 12 条可见文本优先极速出字 + 5 路并发大包 + 5000 条跨天本地缓存（0% GPU 占用），常逛网站切页 0ms 秒出中文。
- **整段无感双语对照**：按完整语义段落翻译，无色块、无竖线，融入网页原本排版，按钮与导航栏不撑破布局。
- **清晰图片文字翻译（悬停译图 + `Alt + I` 框选）**：悬停图片右上角点击 **译图**、右键图片翻译，或按 `Alt + I` 任意框选图表/截图区域；弹出高清毛玻璃结构化卡片逐条展示译文，支持「仅译文 / 双语」切换与一键复制，告别糊在原图上的文字。
- **划词沉浸式对照**：选中任意外语片段弹出双按钮毛玻璃条——`划词翻译`（弹窗支持复制与朗读）或 `沉浸对照`（直接在该段下方插入双语译文）。
- **可拖动毛玻璃悬浮球 & 右键菜单**：内置 DualPage 矢量 Logo，支持全屏拖动、左右贴边吸附、跨页记住位置，点 `⋯` 或右键菜单即可一键控制。
- **多引擎 + 开放任意自定义 API**：
  - **免 Key 开箱即用**：Google 网页（默认极速）、浏览器原生本地离线翻译（Chrome/Edge 内置 AI）、Pollinations 开源 AI（含文字与视觉识图），支持三级自动切换兜底。
  - **自带 Key / 自定义 API**：独立极简配置页，多平台 Key 独立保存，支持智谱 GLM（自动复用免费视觉模型 `glm-4v-flash`）、硅基流动（自动调用免费视觉模型 `Qwen2.5-VL`）、DeepSeek、Google Gemini 及任意 OpenAI 兼容接口 / 本地 Ollama。
- **可视化专属术语表（支持 Excel 模板）**：支持在配置页逐条增删，一键下载 UTF-8 CSV 模板用 Excel/WPS 编辑后导入，或一键导出/导入整套配置 JSON 分享给团队。

---

## 一键下载 & 30 秒安装（Chrome / Edge）

1. **[👉 点此一键下载最新版压缩包 (`DualPage-latest.zip`)](https://github.com/zoe88dackel-rgb/DualPage/releases/latest/download/DualPage-latest.zip)** 并解压到本地任意文件夹。
2. 在浏览器地址栏打开 `chrome://extensions/` 或 `edge://extensions/`。
3. 打开右上角 **「开发者模式」** 开关（浏览器自带功能，完全免费）。
4. 点击左上角 **「加载已解压的扩展程序」**，选择刚刚解压出的文件夹即可立即使用。

---

## 快捷键

- `Alt + T`：一键开关当前网页实时翻译 / 还原原文
- `Alt + I`：框选截屏翻译任意图片或图表中的文字
- `Esc`：关闭划词/译图卡片、框选层或快捷菜单

---

## 隐私说明

详见 [PRIVACY.md](./PRIVACY.md)。
