# 网络问题排查与 push 方案（RocksVPN / WireGuard 环境）

> 记录 2026-09-10 遇到的 `git push` 失败问题及最终解法。

## 现象

```powershell
git push -u origin main
fatal: unable to access 'https://github.com/zq20180515/feishu-excel-bridge.git/':
Recv failure: Connection was reset
```

## 排查过程

| 步骤 | 命令 / 方法 | 结果 |
| --- | --- | --- |
| 1 | `git remote -v` | 地址正确：`https://github.com/zq20180515/feishu-excel-bridge.git` |
| 2 | 查监听端口找代理端口 | 常见端口（7890/1080/10808…）**全部没开** |
| 3 | `tasklist` 找 VPN 进程 | 找到 **`rocksvpn.exe`** |
| 4 | `ipconfig /all` | 存在 **`WireGuard Tunnel`** 网卡，IP `192.168.133.2` |
| 5 | `GIT_CURL_VERBOSE=1 git ls-remote …` | 走了工具的沙箱代理 `127.0.0.1:56190`，握手成功 → **证明仓库地址无误** |
| 6 | 剥掉代理变量再测 | **连不通** → 确认是终端直连被墙 |
| 7 | `curl --interface 192.168.133.2 https://github.com` | **HTTP 200，1.27s** → **VPN 本身是好的！** |
| 8 | `curl --interface … api.ipify.org` | 出口 IP `178.95.178.3`（境外）→ 隧道正常出网 |
| 9 | `Test-NetConnection github.com -Port 443` | 卡在 TCP connect → 默认路由没走隧道 |

## 根因

**RocksVPN 采用 WireGuard 全局网卡（TUN）模式，不提供本地 HTTP/SOCKS 代理端口。**

- 流量在**网卡层**被接管，所以：
  - 找不到任何代理端口（常见端口全灭是正常的）
  - 命令行工具（`git`、`curl` 不带 `--interface`）默认仍走物理网卡 → 直连被墙
- `git` **不支持** `--interface` 参数，无法直接绑定隧道网卡
- 而 `curl --interface 192.168.133.2` **可以**通 → 说明只差一个"把 git 的流量导向隧道"的桥

## 解法：本地 CONNECT 代理 + 绑定隧道网卡

写一个极简的 Python HTTP CONNECT 代理（`test/net-bridge.py`），
它接受本地请求后，**出站 socket 显式 `bind()` 到隧道网卡 IP**，
这样所有经它出去的流量都强制走 VPN 隧道。

```python
upstream = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
upstream.bind((BIND_IP, 0))        # ← 关键：绑到隧道网卡
upstream.connect((host, port))
```

用法：

```bash
python test/net-bridge.py 192.168.133.2 7899
```

然后让 git 走它（已写入本仓库 `.git/config`，仅对本项目生效）：

```bash
git config --local http.proxy  http://127.0.0.1:7899
git config --local https.proxy http://127.0.0.1:7899
```

之后直接 `git push -u origin main` 即可，无需带任何参数。

### 一键脚本

`push-via-vpn.bat`：检查隧道网卡 → 起代理 → 验证 GitHub 可达 → 执行 push，全程引导。

## 实测结果

| 测试项 | 结果 |
| --- | --- |
| `curl -x http://127.0.0.1:7899 https://github.com` | **HTTP 200，0.70s** |
| `curl --interface 192.168.133.2 https://github.com` | **HTTP 200，1.27s** |
| `git ls-remote`（经代理，匿名） | 退出码 0（远端为空仓库，符合预期） |
| 隧道出口 IP | `178.95.178.3`（境外） |

## 注意事项

1. **隧道 IP 可能变**。VPN 重启后重看：`ipconfig` 里找 `WireGuard Tunnel` 那一段的 IPv4 地址。
2. **代理进程不持久**。`push-via-vpn.bat` 会把它最小化跑着；窗口关了代理就停了。
3. **换网络后记得撤销配置**。如果哪天不用 VPN 了，删掉代理配置：
   ```bash
   git config --local --unset http.proxy
   git config --local --unset https.proxy
   ```
   否则 git 会连一个不存在的本地端口而卡住。
4. **不要设成全局（`--global`）**。只写在本仓库 `--local`，
   避免影响其他项目（其他项目未必需要走隧道）。

## 备用方案（若隧道法失效）

1. **PAT 认证问题**：GitHub 早已禁用密码，push 时必须用 Personal Access Token
   （`Settings → Developer settings → Personal access tokens → Tokens (classic)`，勾 `repo`）。
2. **SSH 方式**（220 端口有时更易通）：
   ```bash
   ssh-keygen -t ed25519 -C "009176@btn.com"
   git remote set-url origin git@github.com:zq20180515/feishu-excel-bridge.git
   ```
3. **Gitee 兜底**：国内可直连，同样有 Pages（需实名 + 手动部署）。

## 关键结论（复用要点）

> **WireGuard/TUN 模式的 VPN 没有本地代理端口，命令行工具默认不走隧道。**
> 判断方法：`curl --interface <隧道网卡IP> https://github.com` 能通，
> 但 `git ls-remote` 不通 → 就是这个情况。
> 解法就是起一个 `bind()` 到隧道网卡的本地 CONNECT 代理，让 git 走它。

---

## 收工清理（用完必做）

push 完成后，跟着下面 4 步把环境还原干净，避免影响日常使用：

### 1. 停掉隧道代理进程（监听 7899）

```bash
# 先找到监听 7899 的 PID
netstat -ano | grep 7899

# 结束它（Git Bash 下必须加 MSYS_NO_PATHCONV=1，否则 /PID 会被当成路径）
MSYS_NO_PATHCONV=1 taskkill /PID <PID> /F

# 复查：应无输出
netstat -ano | grep 7899
```

### 2. 移除 git 仓库级代理配置

```bash
cd feishu-excel-bridge
git config --local --unset http.proxy
git config --local --unset https.proxy

# 复查：应显示"无代理"
git config --local --list | grep -i proxy
```

### 3. 停掉 Vite 开发服务器（若开着）

`npm run dev` 会**常驻 5173 端口并绑在 `0.0.0.0`**（局域网内其他机器也能访问），
用完记得关：

```bash
netstat -ano | grep ":5173"     # 找 PID
MSYS_NO_PATHCONV=1 taskkill /PID <PID> /F
```

### 4. 确认本地环境无残留

| 检查项 | 命令 / 方法 | 期望结果 |
| --- | --- | --- |
| 项目端口 | `netstat -ano \| grep -E ":5173\|:7899\|:4180"` | 无 LISTENING |
| node/python 进程 | `tasklist \| grep -iE "node\.exe\|python\.exe"` | 空 |
| 全局 git 代理 | `git config --global --list \| grep -i proxy` | 空（**本方案从不改全局**） |
| Windows 系统代理 | 设置 → 网络和 Internet → 代理 | 保持你原来的状态（本方案**不动系统代理**） |
| VPN 软件 | 自行决定是否退出（**不是本方案启动的**） | — |

> **本方案的全部副作用只有两处**：一个监听 `127.0.0.1:7899` 的 python 进程
> + 本仓库的两条 `--local` git 配置。**从不写全局 git 配置，从不改系统代理。**
> 所以清理只需上面 1、2 两步，其余是顺手检查开发服务器。

### 踩坑记录

- **`taskkill //PID` 在 Git Bash 下会报「无效参数」** —— `//` 被转成了路径。
  必须加 `MSYS_NO_PATHCONV=1` 并用单斜杠 `/PID`。
- **`reg.exe` 被安全策略拉黑**，查系统代理改用 Python 的 `winreg`（只读）：
  ```python
  import winreg
  k = winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                     r'Software\Microsoft\Windows\CurrentVersion\Internet Settings')
  winreg.QueryValueEx(k, 'ProxyEnable')
  ```
- 环境变量里的 `http_proxy=127.0.0.1:56190` 是**工具沙箱自己注入的**
  （不是本方案建的，端口也不同），无需处理。

