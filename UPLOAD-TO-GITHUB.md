# 上传到 GitHub —— 照着敲这几行就行

> 目标：把本地这份代码推到 GitHub，并拿到一个 HTTPS 地址给多维表格用。
> 全程**不需要服务器、不需要备案、不花钱**。
> 完整版（含排错）见 `DEPLOY.md`，这里只留最短路径。

---

## 一、先在 GitHub 上建一个空仓库

1. 登录 https://github.com （没有账号先注册）
2. 右上角 **`+`** → **New repository**
3. 这样填：

   | 项 | 填什么 |
   | --- | --- |
   | Repository name | `feishu-excel-bridge` |
   | Description | `飞书多维表格插件：Excel 图片导入导出双向桥接` |
   | Public / Private | 选 **Public** |
   | Add a README / .gitignore / license | **一个都不要勾**（勾了会和本地冲突） |

4. 点 **Create repository**
5. 建完后页面会显示一堆命令 —— **不用管**，往下走

---

## 二、准备一个"密码"（Personal Access Token）

GitHub 早就不收账号密码了，push 时要用 token 代替密码。

1. GitHub → 右上角头像 → **Settings**
2. 左侧拉到最底 → **Developer settings**
3. **Personal access tokens** → **Tokens (classic)**
4. 右上 **Generate new token** → **Generate new token (classic)**
5. Note 随便写（如 `feishu-bridge`），Expiration 选 `90 days` 或 `No expiration`
6. 权限列表里**只勾一个**：**`repo`**（勾上会连带勾住 4 个子项，正常）
7. 拉到底点 **Generate token**
8. **立刻复制那串 `ghp_xxxxx`** —— 页面一关就再也看不到了

---

## 三、在本地推上去

打开终端（Git Bash / PowerShell 都行），**逐行**执行：

```bash
cd C:/Users/Administrator/WorkBuddy/2026-09-10-16-46-36/feishu-excel-bridge

git remote add origin https://github.com/你的用户名/feishu-excel-bridge.git

git push -u origin main
```

> 把 `你的用户名` 换成你的 GitHub 用户名。
>
> 执行到 `git push` 时**会弹出登录框**（或终端里提示输入）：
> - **Username**：你的 GitHub 用户名
> - **Password**：粘贴刚才那串 `ghp_xxxxx`（**不是**你的 GitHub 登录密码）
>
> 粘贴时终端可能不显示字符，这是正常的，粘完直接回车。

推送成功后应该看到类似：

```
 * [new branch]      main -> main
branch 'main' set up to track 'origin/main'.
```

---

## 四、开启自动部署（关键一步，别漏）

仓库里已经放好了 `.github/workflows/deploy.yml`，push 之后它会自动构建并发布。
但**总开关要你手动打开一次**：

1. 进仓库页面 → 顶部 **Settings**
2. 左侧菜单 → **Pages**
3. **Build and deployment** → **Source** 改成 **`GitHub Actions`**
   ⚠️ 不要选 "Deploy from a branch"，选了会白屏
4. 不用点保存，改完自动生效

然后：

5. 顶部 **Actions** 标签 → 看到 `Deploy to GitHub Pages` 在跑
6. 等 1~3 分钟，圆圈变 **绿色 ✅**
7. 回到 **Settings → Pages**，会显示地址：

```
https://你的用户名.github.io/feishu-excel-bridge/
```

8. 浏览器打开这个地址，能看到插件界面（会提示"未检测到多维表格环境"，正常）

---

## 五、拿到地址后，去飞书接进来

1. 打开飞书多维表格 → 右上角 **插件** 图标 → 拉到底 **自定义插件**
2. **+ 新增插件**
3. 名称：`BTNExcel 桥`；服务地址：把第四步那个 `https://...github.io/.../` 填进去
4. 确定 → 打开插件

**测这两件事就够：**
- 把 `samples/示例源表_内嵌图.xlsx` 拖进去 → 点导入 → 回多维表格看**图片有没有进「附件」字段**
- 选那张表 → 导出 → 用 WPS 打开，看**图片是不是在单元格里**

---

## 六、以后改了代码怎么更新

```bash
cd C:/Users/Administrator/WorkBuddy/2026-09-10-16-46-36/feishu-excel-bridge
npm test                        # 先确认测试全绿
git add -A
git commit -m "fix: 说明你改了什么"
git push
```

push 后 Actions 自动重跑，**约 1 分钟线上就更新了**。
飞书里**不用**重新添加插件 —— 地址没变。

---

## 卡住了？对照下面

| 报错 / 现象 | 原因与解法 |
| --- | --- |
| `remote origin already exists` | 加过了。改用：`git remote set-url origin https://github.com/你的用户名/feishu-excel-bridge.git` |
| `src refspec main does not match any` | 本地分支名不对。查：`git branch --show-current`，应输出 `main` |
| `Authentication failed` | 密码处填的是登录密码。必须用 `ghp_` 开头的 token |
| `Support for password authentication was removed` | 同上，用 token |
| push 成功但 Actions 红了 | 点进 Actions 看日志。常见两种：①`npm test` 没过 → 本地跑 `npm test` 复现；②忘了第四步把 Source 改成 GitHub Actions |
| 页面打开是 404 | ①Actions 还没跑完，等等；②Source 没选 GitHub Actions；③仓库是 Private（Pages 免费版要 Public） |
| 页面白屏 | 多半是 Actions 部署的是仓库根目录而不是 `dist`。本项目已配好 `base: './'` 与 workflow，正常不会出现 |
| 飞书里填地址提示无效 | 地址必须以 `https://` 开头，且能公开访问。GitHub Pages 都满足 |
