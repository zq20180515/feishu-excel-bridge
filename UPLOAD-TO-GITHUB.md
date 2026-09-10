# 上传到 GitHub —— 照着敲这几行就行

> 目标：把本地这份代码推到 GitHub，并拿到一个 HTTPS 地址给多维表格用。
> 全程**不需要服务器、不需要备案、不花钱**。
> 完整版（含排错）见 `DEPLOY.md`，这里只留最短路径。

---

## ⚠️ 先看这个：国内网络连不上 GitHub 怎么办

如果你执行 `git push` 报 **`Recv failure: Connection was reset`**，是网络被墙了，不是配置错。

**先确认你的 VPN 类型：**

| 你的 VPN | 有没有本地代理端口 | 怎么办 |
| --- | --- | --- |
| Clash / v2ray / Clash Verge | 有（通常 `7890` / `7897`） | 直接用方案 A |
| **RocksVPN / WireGuard / 全局 TUN 模式** | **没有**（流量在网卡层接管） | 用方案 B |

### 方案 A：有代理端口的（Clash 等）

找到端口后执行（把 `7890` 换成你的端口）：

```powershell
cd C:\Users\Administrator\WorkBuddy\2026-09-10-16-46-36\feishu-excel-bridge
git config --local http.proxy http://127.0.0.1:7890
git config --local https.proxy http://127.0.0.1:7890
```

### 方案 B：WireGuard / 全局 TUN 模式（RocksVPN 就是这种）

这种 VPN **没有代理端口**，命令行工具默认不走隧道，所以要起一个本地小代理中转。
**已给你写好一键脚本**，直接双击运行：

```
push-via-vpn.bat
```

它会自动：检查隧道网卡 → 启动本地代理 → 验证 GitHub 可达 → 执行 push。

> 原理与手动步骤见 `PUSH-VIA-VPN.md`。
> 判断你是不是这种情况：`ipconfig` 里能看到 **`WireGuard Tunnel`** 网卡。

**以上两种方案都不行**（比如公司网络完全封死）→ 见文末「都不行怎么办」。

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

> 💡 **走隧道代理的情况**：如果用了一键脚本 `push-via-vpn.bat`，
> 或者已经配过 `git config --local http.proxy`，那么 `git push -u origin main`
> 会自动走代理，**不用再加任何参数**。

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
| **`Recv failure: Connection was reset`** | **网络被墙**。见本文开头的方案 A / B |
| **`Failed to connect to github.com:443 over proxy 127.0.0.1`** | 代理进程没起来（脚本窗口被关了）。重新运行 `push-via-vpn.bat` |
| `remote origin already exists` | 加过了。改用：`git remote set-url origin https://github.com/你的用户名/feishu-excel-bridge.git` |
| `src refspec main does not match any` | 本地分支名不对。查：`git branch --show-current`，应输出 `main` |
| `Authentication failed` | 密码处填的是登录密码。必须用 `ghp_` 开头的 token |
| `Support for password authentication was removed` | 同上，用 token |
| push 成功但 Actions 红了 | 点进 Actions 看日志。常见两种：①`npm test` 没过 → 本地跑 `npm test` 复现；②忘了第四步把 Source 改成 GitHub Actions |
| 页面打开是 404 | ①Actions 还没跑完，等等；②Source 没选 GitHub Actions；③仓库是 Private（Pages 免费版要 Public） |
| 页面白屏 | 多半是 Actions 部署的是仓库根目录而不是 `dist`。本项目已配好 `base: './'` 与 workflow，正常不会出现 |
| 飞书里填地址提示无效 | 地址必须以 `https://` 开头，且能公开访问。GitHub Pages 都满足 |

---

## 方案 A / B 都不行怎么办

公司网络彻底封死了 GitHub 的话，还有三条路：

### 1. 换 SSH（220 端口有时比 443 更容易通）

```powershell
ssh-keygen -t ed25519 -C "009176@btn.com"     # 一路回车
cat ~/.ssh/id_ed25519.pub                      # 复制这一整行
```

到 GitHub → `Settings → SSH and GPG keys → New SSH key` 粘贴进去，然后：

```powershell
git remote set-url origin git@github.com:你的用户名/feishu-excel-bridge.git
git push -u origin main
```

### 2. 网页手动上传（不推荐，但如果实在连不上 git 就用）

登录 github.com → 进仓库 → **Add file → Upload files** → 把**项目文件拖进去**。

⚠️ 三条注意事项：

- **千万别拖 `node_modules` 和 `dist`**。前者几万个文件会直接爆掉上传限制（单次最多 100 个文件）；
  后者是构建产物，Actions 会自动生成。
  → 拖的时候**手动展开子目录**，只拖：`src/`、`test/`、`samples/`、`assets/`、
  `.github/`、`index.html`、`package.json`、`package-lock.json`、`tsconfig.json`、
  `vite.config.ts`、`app.json`、`block.json`、`*.md`、`.gitignore`
- **。github/workflows 可能不触发**。上传完去 Actions 页面看看有没有自动建 workflow。
  没有的话，在仓库 Settings → Actions → General 里把 Workflow permissions 设为
  `Read and write permissions`。
- **中文文件名**（`samples/` 里那几个 xlsx）浏览器上传偶尔会乱码，传完在网页上核对一下文件名。

### 3. 改用 Gitee（国内直连，不用梯子）

```powershell
git remote add gitee https://gitee.com/你的Gitee用户名/feishu-excel-bridge.git
git push -u gitee main
```

Gitee 也有静态 Pages（需实名认证 + 手动点部署）。上架表单第 ⑩ 项如果要填 GitHub 地址，
就填 Gitee 地址并在旁边说明原因。

---

## 附：隧道方案的技术原理

`PUSH-VIA-VPN.md` 记录了完整排查过程。一句话总结：

> **WireGuard / 全局 TUN 模式的 VPN 没有本地代理端口，命令行工具默认不走隧道。**
> 判断方法：`curl --interface <隧道网卡IP> https://github.com` 能通，
> 但 `git ls-remote` 不通 → 就是这个情况。
> 解法是起一个 `bind()` 到隧道网卡的本地 CONNECT 代理（`test/net-bridge.py`），让 git 走它。

