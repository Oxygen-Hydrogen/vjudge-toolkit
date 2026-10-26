# Vjudge Toolkit

在 VS Code 里刷 Vjudge 的插件：看比赛、看题目、看文章，一键提交，一键跳转题目/提交页。

不用再在浏览器和编辑器之间来回切换、复制粘贴代码了。

---

## 功能

| 能力 | 说明 |
| --- | --- |
| 登录 Vjudge | 账号密码登录（密码存在 VS Code 的密钥存储里）；也可用浏览器 Cookie 直接接管会话 |
| 看比赛 | 侧边栏列出比赛，展开就是题目列表；点击任意题目在编辑器旁边打开题面 |
| 看题目 | 在 VS Code 内渲染题面（保留表格、图片、公式排版），速度比开浏览器快 |
| 看文章 | Vjudge 文章（Markdown 正文）在面板内渲染，`[problem:POJ-1031]` 自动变成可点击的题目链接 |
| 一键提交 | 从题目面板或编辑器右键直接提交当前文件（自动带语言、比赛密码、contest version） |
| 一键跳转 | 复制/打开题目链接、提交链接；比赛题直接跳到 `contest/{id}#problem/{letter}` |
| 侧边栏记录 | 打开过的比赛/题目/文章自动存进侧边栏，下次直接点 |
| 链接智能识别 | 粘贴 `https://vjudge.net/contest/500000#problem/A`、`CodeForces-1A`、`500000` 都能识别 |

## 安装

```bash
git clone <this-repo> && cd vjudge-toolkit
npm install
npm run compile
```

然后用 VS Code 打开这个目录，按 `F5` 启动「扩展开发宿主」窗口即可调试。

要长期使用，打包成 vsix：

```bash
npx @vscode/vsce package
code --install-extension vjudge-toolkit-0.1.0.vsix
```

## 使用

### 1. 登录

左侧活动栏点 Vjudge 图标 → 标题栏的「登录」按钮（或命令面板 `Vjudge: 登录`）。

如果 Vjudge 弹人机验证导致密码登录失败，用 `Vjudge: 使用浏览器 Cookie 登录`：
浏览器打开 vjudge.net → F12 → Network → 任意请求 → 复制 `Cookie` 请求头 → 粘贴进来。

### 2. 打开内容

- `Vjudge: 打开比赛` → 输入 `500000` 或完整链接
- `Vjudge: 打开题目` → 输入 `CodeForces-1A` 或完整链接
- `Vjudge: 打开文章` → 输入 `1` 或完整链接
- `Vjudge: 打开链接 / ID（智能识别）` → 什么都行，插件自己判断

打开过的东西会留在左侧边栏，直接点就行。

### 3. 提交

三种入口：

1. 题目面板右上角「提交代码」
2. 侧边栏题目项右键 →「提交到当前题目」
3. 编辑器里右键 →「提交当前文件」（文件前 25 行里有 vjudge 链接时会自动识别是哪道题；识别不到会问你）

提交面板里预填了当前编辑器的代码，能选语言、填比赛密码、勾选「公开代码」，点「提交」即可。
成功后弹出 Run ID，可以直接跳提交记录。

### 4. 跳转

- 题目面板上的「在浏览器打开」「复制链接」
- 侧边栏右键：复制题目链接 / 复制提交链接 / 在浏览器打开

## 设置项

| 设置 | 默认 | 说明 |
| --- | --- | --- |
| `vjudge.openMode` | `webview` | `webview` 用插件自带渲染（推荐）；`browser` 全走系统浏览器（这时不需要登录插件也能用）；`simpleBrowser` 用 VS Code 内置简单浏览器 |
| `vjudge.requestTimeout` | `20000` | 请求超时（毫秒） |
| `vjudge.maxItemsPerGroup` | `30` | 侧边栏每组保留多少条 |
| `vjudge.languageId` | `""` | 默认语言 ID；留空则用题目页解析出的第一个语言 |
| `vjudge.openSource` | `true` | 提交时是否公开代码 |
| `vjudge.copyOnFallback` | `true` | 自动提交失败时把代码复制到剪贴板并打开提交页 |

## 提交是怎么实现的

抓包确认的 Vjudge 内部接口（集中在 `src/constants.ts` 和 `src/client/vjudgeClient.ts`，改版时改这两处即可）：

```
POST /user/login                                  username, password
GET  /user/checkLogInStatus                       返回 true / false
POST /contest/submit/{contestId}/{num}             method, language, open, source, accessCode, version
POST /problem/submit/{oj}-{probNum}                method, language, open, source
```

页面数据不靠正则硬猜：Vjudge 把结构化数据序列化在 `<textarea name="dataJson">` 里，
插件直接 `JSON.parse` 它（比赛元信息、文章 Markdown 正文、语言列表都从这儿来），
解析不到时才回退到 HTML 选择器，再不行就提示「在浏览器打开」。

### 关于人机验证

Vjudge 的提交表单带 Cloudflare Turnstile，服务端可能返回 `{ "challenge": true }`。
这种情况下插件不会假装成功，而是：

1. 把代码复制到剪贴板
2. 打开对应的提交页面
3. 明确告诉你「请在打开的页面里粘贴提交」

这是有意为之：绕过人机验证既不可靠也不合适。

## 已知限制

- **比赛题目列表需要登录**。Vjudge 对未登录用户不下发 `problems` 字段，此时比赛面板会提示你先登录。
- 练习题提交的语言列表来自题目页；如果没解析到，提交面板会让你手动填语言 ID。
- 比赛题面的部分情况是 iframe 嵌入的外部页面，插件会显示提示并给出原地址，不强行渲染。
- Vjudge 没有公开 API，这些接口属于内部实现，随时可能变。插件所有接口路径、解析逻辑都集中放置并带日志（输出面板 `Vjudge`），出问题时用 `Vjudge: 查看抓取到的原始 HTML（调试）` 抓一份页面就能快速定位。

## 目录结构

```
src/
  extension.ts              激活入口
  app.ts                    业务编排：打开/提交/链接路由
  commands.ts               命令注册
  constants.ts              端点、URL 拼装（改版时改这里）
  store.ts                  侧边栏记录持久化
  client/
    httpClient.ts           fetch + Cookie + 重定向 + 超时
    cookieJar.ts            Cookie 管理（Node 的 fetch 不会自动带 cookie）
    session.ts              Cookie / 用户名 / 密码持久化
    vjudgeClient.ts         登录、抓页、提交
    parsers.ts              dataJson 解析 + HTML 兜底解析 + HTML 清洗
  providers/treeProvider.ts 侧边栏树
  views/
    webview.ts              面板 HTML 外壳与主题样式
    contentPanels.ts        比赛 / 题目 / 文章面板
    submitPanel.ts          提交面板
    markdown.ts             极简 Markdown 渲染（含 [problem:] 语法）
media/icon.svg
```

## License

MIT
