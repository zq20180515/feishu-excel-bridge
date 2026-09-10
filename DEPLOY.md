# 部署到 GitHub Pages

> 目标：把插件发布到一个**公网 HTTPS 地址**，供多维表格加载、供集团同事使用。
> 全程免费，不需要服务器，不需要备案。

---

## 前提

- 一个 GitHub 账号（没有就先去 https://github.com/signup 注册）
- 本机已装 Git（本机已有 `git version 2.55.0`）

---

## 第 1 步：在 GitHub 上建一个空仓库

1. 登录 GitHub，点右上角 **`+`** → **New repository**
2. 填写：

   | 字段 | 填什么 |
   | --- | --- |
   | **Repository name** | `feishu-excel-bridge` |
   | Description | `飞书多维表格插件：Excel 图片导入导出双向桥接` |
   | 公开性 | **Public**（Pages 免费版需要公开仓库；集团内部使用也建议 Public，代码里没有任何密钥） |
   | Initialize this repository with | **全都不勾**（不要勾 README / .gitignore / license，否则会和本地冲突） |

3. 点 **Create repository**
4. 建完后页面会显示一段命令，**先不用管**，往下走

---

## 第 2 步：把本地代码 push 上去

代码已经初始化好 git 并完成首次提交了（38 个文件，`node_modules` / `dist` 已排除）。
你只需要在项目目录里执行下面两条命令：

```bash
cd C:/Users/Administrator/WorkBuddy/2026-09-10-16-46-36/feishu-excel-bridge

# 把 <你的用户名> 换成你的 GitHub 用户名
git remote add origin https://github.com/<你的用户名>/feishu-excel-bridge.git

git push -u origin main
```

> **会要求登录**：GitHub 现在不接受密码，需要用 **Personal Access Token** 当密码。
> 生成方式：GitHub → 右上角头像 → **Settings** → 左侧最下 **Developer settings**
> → **Personal access tokens** → **Tokens (classic)** → **Generate new token (classic)**
> → 勾选 **`repo`** 权限 → 生成后**立刻复制**（页面关了就再也看不到）。
> push 时用户名叫你的 GitHub 用户名，密码粘贴这个 token。

> 如果本机配过 GitHub 凭据助手，可能会弹浏览器让你授权，点同意即可。

---

## 第 3 步：开启 GitHub Pages ⚠️ 最容易漏的一步

仓库已经放了 `.github/workflows/deploy.yml`，push 之后会自动构建部署。你只需要打开开关：

1. 进入仓库页面 → **Settings**（顶部标签栏）
2. 左侧栏 → **Pages**
3. **Build and deployment** → **Source** 选 **`GitHub Actions`**（不是 "Deploy from a branch"）
4. 不用点保存，改完自动生效

> ⚠️ **这一步漏掉的症状**：Actions 里 `build` 阶段全绿（依赖、测试、构建都过），
> 但 `deploy` 阶段失败，报错形如 `HttpError: Not Found ... /pages`。
> 原因是 `actions/deploy-pages@v4` 要求仓库**已经启用 Pages 服务**，
> 没有启用时它无处可部署。
>
> **事后补救**：回到这一步把 Source 改成 `GitHub Actions`，
> 然后去 Actions 页面找到失败的那次运行，点 **Re-run all jobs** 重跑即可。
> （不用重新 push，也不用改代码。）

---

## 第 4 步：等部署跑完

1. 仓库顶部 **Actions** 标签 → 会看到一条 `Deploy to GitHub Pages` 正在跑
2. 首次约 1~3 分钟。它会依次：装依赖 → **跑 151 项测试** → 构建 → 发布
3. 变绿 ✅ 后，回到 **Settings → Pages**，会显示访问地址：

```
https://<你的用户名>.github.io/feishu-excel-bridge/
```

4. **用浏览器打开这个地址**，应该能看到插件界面（会提示"未检测到多维表格插件运行环境"，
   这是正常的——它需要在多维表格 iframe 里才能真正工作）

> 💡 如果 Actions 红了，点进去看日志。最常见的两个原因：
> - 测试没通过 → 本地跑 `npm test` 复现并修
> - 忘了在第 3 步把 Source 改成 GitHub Actions

---

## 第 5 步：在飞书里接进来验证

1. 打开飞书多维表格
2. 右上角 **插件** 图标 → 拉到底点 **自定义插件**
3. 点 **+ 新增插件**
4. 名称填 `BTNExcel 桥`，服务地址填第 4 步那个 `https://...github.io/.../`
5. 点确定，然后打开它

**自测清单：**

- [ ] 插件能打开，能看到「导入 Excel / 导出为 Excel」两个标签
- [ ] 把 `samples/示例源表_内嵌图.xlsx` 拖进去，字段映射区正常显示
- [ ] 点「开始导入」，看看进度块动画，结束后结果卡片有写入条数
- [ ] 到多维表格里确认图片真的进了「附件」字段（**这是最关键的一步**）
- [ ] 切到导出标签，选那张表，导出后用 WPS 打开确认图片在单元格里
- [ ] 点「打开文件所在位置」，看看是否弹出系统保存对话框（见 `SUBMIT.md` 的 Q2）
- [ ] 点插件名右侧「反馈」，确认弹层不透明、能复制反馈模板

---

## 后续更新插件

改完代码后：

```bash
npm test          # 先确认测试全绿
git add -A
git commit -m "fix: 描述你改了什么"
git push
```

push 到 `main` 后 Actions 会自动重新构建部署，**大约 1 分钟后线上地址就更新了**，
不需要你在飞书里重新添加插件——地址没变。

---

## 常见问题

**Q：可以不用 GitHub Pages，用自己的服务器吗？**
可以。`npm run build` 产出的 `dist/` 目录就是完整站点，扔到任意静态托管（Nginx / OSS / COS 等）即可。
要求：**必须 HTTPS**。因为插件里用了 `showSaveFilePicker`（要求安全上下文），
且飞书插件本身也要求 HTTPS 地址。

**Q：仓库一定要 Public 吗？**
Pages 在免费账号下需要 Public 仓库。本插件代码里**没有任何密钥或敏感信息**
（`app.json` 里的 `appId` 只是占位符，真正的凭证在飞书开发者后台），公开没有风险。
如果公司政策不允许公开，可以改用公司内网服务器部署。

**Q：push 报错 `remote origin already exists`？**
说明已经加过 remote 了，改用：
```bash
git remote set-url origin https://github.com/<你的用户名>/feishu-excel-bridge.git
```

**Q：push 报 `src refspec main does not match any`？**
分支名不对。确认一下：
```bash
git branch --show-current   # 应该输出 main
```

**Q：想换一个仓库名？**
改仓库名后 Pages 地址也会变，需要回飞书里**编辑**那个自定义插件的地址。
注意 `vite.config.ts` 里已经设了 `base: './'`，用的是相对路径，
所以**换任何仓库名/子路径都不用改代码**。
