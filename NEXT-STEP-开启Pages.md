# 现在只差最后一步：开启 GitHub Pages

## 当前状态（已确认）

| 项目 | 状态 |
| --- | --- |
| 代码推送到 GitHub | ✅ 成功（`5e922f3` 已在远端 `main`） |
| Actions `build` 阶段 | ✅ 全绿：安装依赖 / **151 项测试** / 构建 / 上传产物 |
| Actions `deploy` 阶段 | ❌ 失败：`Pages 未启用` |
| 仓库可见性 | ✅ Public |
| 默认分支 | ✅ main |
| **Pages 服务** | ❌ **`has_pages: false`（就是这个没开）** |

---

## 你要做的（3 分钟）

### 第 1 步：开启 Pages

1. 打开 https://github.com/zq20180515/feishu-excel-bridge/settings/pages
2. 找到 **Build and deployment** → **Source**
3. 下拉选 **`GitHub Actions`**（⚠️ 不要选 "Deploy from a branch"）
4. 改完自动生效，**不用点保存**

### 第 2 步：重跑失败的那次 Actions

1. 打开 https://github.com/zq20180515/feishu-excel-bridge/actions
2. 点进那条 **红色的** `Deploy to GitHub Pages`
3. 右上角 **Re-run all jobs** → 确认

> 不用重新 push，不用改代码。等 1~2 分钟变绿。

### 第 3 步：验证地址

打开：

```
https://zq20180515.github.io/feishu-excel-bridge/
```

**预期**：能看到插件界面（会提示"未检测到多维表格环境"，**这是正常的**，
因为它需要在多维表格的 iframe 里才能拿到表格数据）。

### 第 4 步：在飞书里真正测一遍

1. 打开飞书多维表格 → 右上角 **插件** 图标 → 拉到底 **自定义插件**
2. **+ 新增插件**
3. 名称：`BTNExcel 桥`
4. 服务地址：`https://zq20180515.github.io/feishu-excel-bridge/`
5. 确定 → 打开插件

**自测清单：**

- [ ] 插件能打开，看到「导入 Excel / 导出为 Excel」两个标签
- [ ] 把 `samples/示例源表_内嵌图.xlsx` 拖进去，字段映射区正常显示
- [ ] 点「开始导入」，看进度动画，结束后有写入条数
- [ ] **回多维表格确认图片真的进了「附件」字段**（最关键）
- [ ] 导出 → 用 WPS 打开，确认图片在单元格里
- [ ] 点插件名右侧「反馈」，确认弹层不透明、能复制反馈模板

---

## 常见问题

**Q：Re-run 之后还是红的？**

点进日志看 `deploy` 这一步的具体报错：

- `Not Found ... /pages` → Source 没改成功，回第 1 步重做
- `Resource not accessible by integration` → 去
  `Settings → Actions → General → Workflow permissions`，
  选 **Read and write permissions**，保存后重跑
- 其他报错 → 把日志贴给我

**Q：地址打开是 404？**

- Actions 还没跑完 → 等
- Source 没选 GitHub Actions → 回第 1 步
- 刚开启 Pages 有缓存延迟 → 等 2~5 分钟再试

**Q：这个地址变了会影响上架吗？**

不会。上架表单填的就是这个地址，只要仓库名不改，地址就不会变。
（`vite.config.ts` 里用的是相对路径 `base: './'`，即使改仓库名也不用改代码。）

---

## 之后怎么更新插件

```powershell
cd C:\Users\Administrator\WorkBuddy\2026-09-10-16-46-36\feishu-excel-bridge
npm test
git add -A
git commit -m "fix: 说明改了什么"
git push
```

push 后 Actions 自动重跑，**约 1 分钟线上更新**。
飞书里**不用**重新添加插件（地址没变）。

> ⚠️ 目前还有一个 commit（`0005029`，纯文档改动）没推上去。
> 你下次 `git push` 时会一起带上，不影响功能。

---

## 还记得吗：VPN 代理

如果 `git push` 报 `Failed to connect ... over proxy 127.0.0.1`，
说明隧道代理进程停了 → 双击 `push-via-vpn.bat` 重开即可。

以后不用 VPN 了，记得清掉代理配置（否则 git 会连不存在的端口）：

```powershell
git config --local --unset http.proxy
git config --local --unset https.proxy
```
