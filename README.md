# BTNExcel 桥 · 飞书多维表格插件

解决两件官方原生能力做不到的事：

| 场景 | 官方导入 | 本插件 |
| --- | --- | --- |
| Excel 里的图片列 | 变成 `=DISPIMG("ID_xxx",1)` 文本，图片丢失 | 自动转成**附件字段**，图片原样上传进多维表格 |
| 多维表格导出 | 附件列只能导出文件名/链接 | 图片**嵌回单元格**（WPS `DISPIMG` 内嵌 或 标准浮动图片） |
| 多 sheet 导入 | 手动一张张来 | 一次映射所有 sheet 的字段，点一下各自导入成一张数据表 |

---

## 一、它能做什么

### 导入

1. 拖拽 / 选择本地表格文件，支持 **10 种格式**：

   | 格式 | 说明 | 图片能否解析 |
   | --- | --- | --- |
   | `.xlsx` `.xlsm` `.xltx` `.xltm` `.xlam` | zip 容器 | ✅ 图片 / 附件可解析 |
   | `.xls` `.xlsb` `.ods` | 非 zip 二进制 | ❌ 只能读单元格文本 |
   | `.csv` `.txt` | 纯文本 | ❌ 无图片部件 |

   面板里把所有支持的扩展名列成一排小标签，悬停任意一个都能看到该格式的完整说明；非 zip 格式解析时会给出明确提示（需要图片请先另存为 `.xlsx`）。
   ⚠️ 这一排说明**只在还没选文件时显示** —— 选完文件后自动收起，把侧栏空间全部让给字段映射区。
2. 自动解析 **所有 sheet**，逐列推断字段类型并列出映射表
3. **空白工作表会被自动跳过**：既没有可识别表头、又没有数据行的 sheet 不单独占一个映射块，只在下方用一条提示汇总点名（「已跳过 N 个空白工作表：`Sheet2` `Sheet3`」），避免空白 sheet 把侧栏撑满
4. 每个工作表一个折叠块，单列布局 —— **整个映射区在一屏内完成，不需要左右滑动**
5. 映射表是极简的两段式：**字段名称 → 字段类型**，字段类型用不同颜色的小色块区分（文本灰 / 数字蓝 / 单选多选紫 / 日期橙 / 复选框青 / 附件青绿 / 电话邮箱绿 / 超链接靛），一眼能扫完
6. **字段类型色块本身就是按钮**：点一下胶囊，原地展开一个胶囊菜单，选中即换型；胶囊右侧带 ▾ 下拉箭头指明可交互，不再出现「胶囊写单选 + 旁边下拉框又写单选」的重复。已映射到目标表既有字段时，胶囊变为只读态并挂一个 🔗 联动标记
7. 每一列都可以：
   - **取消勾选 = 删除该字段**，该列不会被导入
   - 改表头名、换目标字段类型（点胶囊）
   - 追加模式下可映射到目标表的**已有字段**（胶囊菜单顶部下拉选择），或按当前名字新建字段
8. 每个 sheet 可单独选择：**导入为新建数据表** / **追加到已有数据表**
9. 点「开始导入」后：
   - 进度区是一个**醒目的动效进度块**：脉冲指示点 + 大号百分比 + 流光进度条 + 「已完成/总数」计数 + 当前阶段明细
   - 图片先**串行**批量上传拿到 `file_token`（`batchUploadFile` 官方禁止并发调用）
   - 每个 sheet 建表 → 解析/新建字段 → 每 200 条一批写记录
   - **新建表时会把多维表格自动生成的空白首列征用成第一个源字段**，多出来的空白列直接删掉，不会留一列空
   - **单选 / 多选会先建好所有选项，再用选项 id 写值**（只传文本会被静默丢弃，见下文「字段类型映射」）
   - 结束时给出每张表的记录数、跳过单元格数与明细错误

### 导出

1. 多选要导出的数据表（每张表 → 一个 Excel Sheet），勾选式卡片网格
2. 附件列里的图片会被下载并**嵌进单元格**，两种方式可选：
   - **WPS嵌入单元格图片**（`=DISPIMG("ID_xxx",1)`）——图片真正待在格子里，随行高列宽一起走
   - **标准浮动图片**——锚定单元格，Excel / WPS / LibreOffice 通用
   - 两种方式的差别写在选项右侧的 **`?` 悬停提示**里，不再占用正文
3. **图片边长是可选填项，与「全部图片都导出」同级**（不再藏在「标准浮动图片」下面）：留空 = **原图原尺寸导出**（默认，推荐）；填数字 = 等比缩放到该边长。**两种嵌图方式都生效**
4. **「全部图片都导出」开关（默认开启）**：
   - 打开（默认）：附件字段里的**每张图片各占一列** —— 原字段叫「照片」时，第 1 张在「照片」、第 2 张在「照片2」、第 3 张在「照片3」……（单字段上限 10 张，超出部分仍列在「附件名」列）
   - 关闭：一个附件单元格只嵌第一张图，其余文件名走「附件名」列
5. 可选额外输出一列「附件名」文本（多值换行），避免多附件时丢信息
6. 导出进度用**独立配色的动效进度块**（蓝色系，和导入的青绿色区分），阶段文案会走过「读取数据表 → 下载附件 → 打包工作簿 → 生成文件」
7. 导出完成后除了「再下载一次」，还多一个 **「打开文件所在位置」** —— 见下文说明

### 顶部反馈入口

插件名「BTNExcel 桥」右侧有一个 **`反馈`** 胶囊按钮。点开是一个**不透明实底弹层**（之前是半透明的，会和页面内容透叠在一起看不清，已修）：

- **反馈对象用 `@张强` 的形式呈现**，而不是「打开飞书会话」按钮 —— 插件 iframe 里无法可靠唤起飞书客户端，与其给一个点了没反应的按钮，不如把要 @ 的人直接摆出来
- **`复制反馈模板`**：一键复制一段可直接粘进飞书的完整文本，含 `@张强`、插件名、**构建期注入的版本号**、问题描述占位与截图提示
- **`只复制 ID`**：复制 `009176`，粘到飞书搜索框也能直接发起聊天
- 弹层里附**插件描述**（支持什么、能做什么），方便对方快速理解上下文

> **关于「打开文件所在位置」**：插件运行在飞书给的 `sandbox` iframe 里，**没有文件系统访问权**，不存在真正打开系统资源管理器的 API。所以做了两级降级：
> 1. 浏览器支持 File System Access API 时，调 `showSaveFilePicker()` 弹出**系统保存对话框**，用户选定目录后系统会跳到该文件夹，文件也落到用户自己选的位置；
> 2. 不支持或被沙箱拒绝时，重新拉起一次同名下载并在界面里给出明确指引（点浏览器右上角下载按钮 / 去「下载」文件夹）。

> **弹层为什么要显式不透明**：`.pop-panel` 是 `position: fixed` 挂在视口上的，脱离了文档流的层叠上下文。
> 如果忘了给实底背景和足够高的 `z-index`，它就会和底下的卡片文字直接透叠 —— 表现就是"文字混在一起看不清"。
> 现在 `.pop-panel` 统一给 `background: var(--surface)` + `z-index: 200` + 边框阴影，`.fb-body` / `.tk-menu` 等内部容器不再重复描边。

---

## 二、接入多维表格

### 方式 A：自定义插件（最快，无需开发者后台）

```bash
npm install
npm run dev          # 默认 http://localhost:5173
```

1. 打开任意多维表格 → 右上角 **插件 / 自定义插件**
2. 把开发服务器地址（如 `http://localhost:5173`）填进去加载
3. 改代码会热更新；但**改完记得在插件里重新加载一次**，iframe 里的页面不会自动重建

生产环境用：

```bash
npm run build        # 产物在 dist/
npx serve dist       # 或丢到你们内网 IIS / nginx
```

把 `https://你的域名/` 填进自定义插件入口即可。注意两点：

- **不要设置 `X-Frame-Options` 和 CSP `frame-ancestors`**，否则飞书 iframe 无法嵌入（`vite.config.ts` 已经留了注释）
- 必须是 **HTTPS**（`localhost` 除外），否则 iframe 里部分能力会被浏览器拦

### 方式 B：走飞书开发者后台正式发布

```bash
npm i -g @lark-opdev/cli
opdev login
cd 你的目录
opdev create . -a bitable-extensions -s dashboard        # 选一个「多维表格插件」模板
```

然后在开发者后台：**添加应用能力 → 多维表格插件 → 自定义页面**，记下 `App ID` 和 `BlockTypeID`，填进本目录的 `block.json` / `app.json`，再：

```bash
npm run build
opdev upload
```

按提示填版本号 → 后台「小组件版本」选该版本 → 上传图标、填名称介绍 → 保存 → 版本管理里申请发布。

> 走这条路线时，`dist/` 的静态产物需要能被飞书 CDN 拉取；`opdev` 会自动打包上传，不用你自建服务器。

### 方式 C：上架到插件市场（集团内部可见）

多维表格的「自定义插件」面板里，对已添加的插件点 **`···` → 发布**，会跳到一个
**「提交多维表格插件」表单**。填完提交后由多维表格团队评估，通过后所有（或指定范围内的）用户
都能在插件市场里搜索安装。

**不需要自己的服务器** —— 因为本插件是纯前端的，`dist/` 扔到任意静态托管即可。推荐组合：

| 环节 | 做法 |
| --- | --- |
| 代码托管 | GitHub 仓库（Public） |
| 插件地址 | **GitHub Pages**（自带 HTTPS，免费，无需备案） |
| 自动发布 | `.github/workflows/deploy.yml`：push 到 `main` → 跑 151 项测试 → 构建 → 部署 |

详细步骤见：

- **[`DEPLOY.md`](./DEPLOY.md)** —— 从建仓库到 Pages 可用的完整命令
- **[`SUBMIT.md`](./SUBMIT.md)** —— 提交表单每一项该填什么（可直接复制的文案）
- **[`SUBMIT-CHECKLIST.txt`](./SUBMIT-CHECKLIST.txt)** —— 同上，纯文本版，填表时开一屏对照复制

> ⚠️ 两个硬性要求：
> 1. 插件地址**必须是 HTTPS**（`localhost` 除外）—— 飞书插件本身要求，且 `showSaveFilePicker`
>    也只在安全上下文可用；
> 2. **不要设置 `X-Frame-Options` / CSP `frame-ancestors`**，否则飞书 iframe 加载不了。
>    GitHub Pages 默认无此限制，可以放心用。
>
> `vite.config.ts` 里 `base: './'` 用的是相对路径，所以**换任何仓库名 / 子路径都不用改代码**
> —— 部署到 `https://user.github.io/whatever-name/` 也能直接跑。

---

## 三、图片是怎么被识别出来的

导入端要同时兼容两种完全不同的存在形式，这是本插件的核心：

### 1. WPS「嵌入单元格图片」

单元格里存的是公式，图片本体在别的部件里：

```
xl/worksheets/sheet1.xml   →  <c r="I2" t="str"><f>DISPIMG("ID_8805AC7ED61347F68868D9FEB2B1289C",1)</f></c>
xl/cellimages.xml          →  <xdr:cNvPr id="2" name="ID_8805AC7ED61347F68868D9FEB2B1289C"/> + <a:blip r:embed="rId1"/>
xl/_rels/cellimages.xml.rels → rId1 → ../media/image7.png
```

解析路径：拿公式里的 ID → 去 `cellimages.xml` 里按 `cNvPr/@name` 反查 → 顺着 rels 找到 `xl/media/imageN.png` → 读成 `File`。
如果 ID 对不上（不同 WPS 版本有差异），会退化成**按出现顺序位置匹配**并在界面上给出提示。

> 注意：真实 WPS 写出的公式是 **`_xlfn.DISPIMG(...)`**（带 `_xlfn.` 前缀），
> 且 `<v>` 里存的是**公式文本**而不是空串。读取端两种写法都认。

### 2. 标准 OOXML 浮动图片

```
xl/worksheets/sheet1.xml → <drawing r:id="rId1"/>
xl/worksheets/_rels/sheet1.xml.rels → ../drawings/drawing1.xml
xl/drawings/drawing1.xml → <xdr:oneCellAnchor><xdr:from><xdr:col>8</xdr:col><xdr:row>1</xdr:row>…<a:blip r:embed="rId1"/>
xl/drawings/_rels/drawing1.xml.rels → ../media/image1.png
```

解析路径：`from` 的 `col/row` 就是锚点单元格（0-based 绝对坐标），顺着 blip → rels 取到媒体文件。
本插件内部**统一使用绝对行列坐标**，所以两种来源的图片能落到同一个坐标空间里，不会错行。

写出去的时候反过来：自己拼 `xl/drawings/drawingN.xml`（或 `xl/cellimages.xml`）+ rels，写进 `xl/media/`，再补 `[Content_Types].xml` 的 Default/Override 条目。

---

## 三之补 · 写 DISPIMG 时的四个坑（都是实测踩出来的）

「导出成 WPS 嵌入单元格图片，WPS 打开却只看到 `@image#1:xxx.png` 文本、图片不渲染」
这个问题由四个独立原因叠加造成，每个都会让 WPS 静默放弃渲染：

| # | 坑 | 正确写法 |
| --- | --- | --- |
| 1 | 公式少了 `_xlfn.` 前缀，WPS 认不出这是自己的扩展函数 | `<f>_xlfn.DISPIMG("ID_xxx",1)</f>` |
| 2 | `<v>` 写成空串，WPS 直接采用这个"缓存结果"（空）而不去求值 | `<v>=DISPIMG("ID_xxx",1)</v>`，必须是公式文本 |
| 3 | `cellimages.xml` 的命名空间 URI 不对 | `xmlns:etc="http://www.wps.cn/officeDocument/2017/etCustomData"` |
| 4 | 图片的 `<a:ext cx="0" cy="0"/>`，WPS 判定尺寸非法 | 按图片真实像素换算 EMU，`cx = px × 9525` |

另外还有一条**非 XML 层**的原因：`xl/cellimages.xml` 与 `xl/_rels/cellimages.xml.rels` 必须排在
ZIP 包内合理位置。SheetJS 会把后写入的部件丢到压缩包末尾，实测 WPS 对乱序包会忽略 cellimages 部件。
因此写出后会**按 OOXML 规范顺序重新打包**（`[Content_Types].xml` 第一，其余按目录树分组），
并补上显式目录条目，与真实 WPS / Office 产出保持一致。

---

## 四、字段类型映射

导入时按列推断，可在界面上手动改：

| 推断规则 | 目标字段类型 |
| --- | --- |
| 该列有图 | 附件 (17) |
| 全是布尔 | 复选框 (7) |
| 全是日期 / 都是 Date 对象 | 日期 (5) |
| 全是数字（含 `1,234` / `12%` / `¥100`） | 数字 (2) |
| 全是 `http(s)://…` | 超链接 (15) |
| 全是邮箱 | 邮箱 (99005) |
| 全是 11 位手机号 | 电话 (13) |
| 基数低（≤30 且 ≤60% 行数）且文本短 | 单选 (3) |
| 其它 | 多行文本 (1) |

日期写回多维表格用的是**毫秒时间戳**；纯数字且 < 100000 会按 Excel 序列号（1900 日期系统）换算。

附件单元格写入的结构（与官方 `setCellValue` 示例一致）：

```ts
{ name, size, type, token, timeStamp }   // token 来自 bitable.base.batchUploadFile
```

**单选 / 多选必须写选项 id，不能写文本。**

这是实测踩出来的第二个大坑：先 `field.addOption('生产部')` 把选项建好，然后把单元格写成字符串 `'生产部'`——
接口**不报错**，但单元格会保持空白。表现就是「点开字段详情能看到选项都建好了，但那一列什么都没有」。

正确写法是带 `id` 的对象（`id` 从 `field.getOptions()` 拿）：

```ts
// 单选
{ id: 'optXXXXXX', text: '生产部' }
// 多选
[{ id: 'optXXXXXX', text: '生产部' }, { id: 'optYYYYYY', text: '质量部' }]
```

所以导入流程是：`addOption` 建全所有选项 → `getOptions()` 回读拿到 `选项名 → 选项 id` 映射 →
逐行用 id 写值。拿不到 id 时才退回纯文本（至少不丢整列）。

**不可写入**的字段类型（人员、地理位置、关联、查找引用、公式、自动编号、评级、进度）：界面会跳过并在结果里报出来，不会静默丢数据。

---

## 五、已知限制

1. **`DISPIMG` 是 WPS 专有扩展。** 用原生 Excel 打开导出的文件时，那些单元格会显示 `=DISPIMG("ID_…",1)` 公式而不是图片（图片数据仍在 `xl/cellimages.xml` + `xl/media/` 里，没有丢）。要在 Excel 里也看到图，请把导出方式切成「标准浮动图片」。
2. **默认一个单元格只嵌第一张图。** 多维表格附件字段可以放多个附件，但 `DISPIMG` 一个单元格只能有一张。想看全部图片，请打开导出侧的「全部图片都导出」，插件会把第 2 张起展开到「照片2」「照片3」……等新列（单字段最多 10 列）。
3. **附件下载依赖临时链接。** 导出走的是 `table.getCellAttachmentUrls()`，链接 10 分钟有效，且跨域是否能 fetch 取决于飞书返回的 CORS 头。失败会在结果里逐条提示，可关掉「嵌入图片」改用文件名导出。
4. **单次 `addRecords` 上限 200 条**，插件已自动分批；`batchUploadFile` **禁止并发**，插件用全局串行链 + 每批 10 个，失败时降级为逐个上传。
5. **只有 zip 容器格式能解析图片。** `.xls / .xlsb / .ods / .csv / .txt` 可以正常读单元格，但图片列会是空的（界面会提示另存为 `.xlsx`）。行数上限 20000、列数上限 512，超出会截断并告警。
6. 导入是**真实写库**操作，同名数据表会加序号新建，同名已有字段会复用而不是重复新建。
7. 新建数据表时多维表格会自动补一个空白文本列，插件会把它**征用**成第一个源字段；源字段少于默认列时，多余的空白列会被删除（删除失败会在结果里提示，可手动删）。
8. **「打开文件所在位置」是尽力而为。** 插件 iframe 无文件系统权限，优先走 `showSaveFilePicker()` 让用户在系统对话框里自选目录；沙箱拒绝时退化为重新下载 + 界面指引。
9. **反馈不能自动打开飞书会话。** 插件 iframe 里唤起客户端不可靠，改成「`@张强` + 复制反馈模板 / 复制 ID」的手动路径 —— 粘到飞书搜索框或直接 @ 该用户即可。
10. **空白工作表判定标准**：可识别表头列数为 0 **或** 数据行数为 0。「只有表头没数据」和「只有数据没表头」都会被跳过（这两种情况都没有可导入的内容），跳过清单会在映射区下方点名列出。

---

## 六、目录结构

```
├── .github/workflows/deploy.yml  push → 跑测试 → 构建 → 部署 GitHub Pages
├── DEPLOY.md                    部署到 GitHub Pages 的完整步骤
├── SUBMIT.md                    上架提交表单的逐项填写内容
├── SUBMIT-CHECKLIST.txt         同上，纯文本速查版（填表时对照复制）
├── assets/icon-512.png          插件图标（512×512 PNG，提交表单第 ⑦ 项用）
├── app.json                     appId + output（opdev 上传用）
├── block.json                   blockTypeID + url
├── samples/                     4 个可视样例 xlsx，可直接用 WPS 打开验证
├── test/                        自测：roundtrip / render / compare-wps / make-samples / make-icon
└── src/
    ├── App.tsx                     两个 Tab：导入 / 导出 + 顶部反馈入口
    ├── styles.css                  素直风格：白卡 + 1px 边框 + 深青点缀
    ├── components/
    │   ├── ImportPanel.tsx         拖拽解析 → 映射 → 选项 → 进度/结果（空白表跳过）
    │   ├── MappingEditor.tsx       多 sheet 字段映射（单列自适应，无横向滚动）
    │   ├── ExportPanel.tsx         数据表多选 + 嵌入方式 + 进度 + 定位文件
    │   ├── icons.tsx               线性图标集（无图标库依赖）
    │   └── ui.tsx                  Card / Notice / Progress / Segmented / Tip / Popover
    └── lib/
        ├── types.ts                数据模型
        ├── xml.ts                  极简 XML 工具（浏览器/Node 行为一致）
        ├── field-meta.ts           字段类型常量、MIME、可导入类型
        ├── infer.ts                值归一化 / 类型推断 / 日期数字解析
        ├── excel-read.ts           xlsx 解析：值 + DISPIMG + 浮动图锚点
        ├── excel-write.ts          xlsx 生成：数据 + 内嵌图/浮动图 + ZIP 规范化重打包
        ├── base-api.ts             SDK 封装：建表/建字段/征用空白列/写记录/选项 id/串行上传
        ├── value-convert.ts        Excel 值 ⇄ 多维表格值（含单选多选的 { id, text }）
        ├── importer.ts             导入执行器
        └── exporter.ts             导出执行器
```

## 七、自测

```bash
npm test                   # roundtrip + render + ui 三套断言
npm run test:roundtrip     # 解析 + 生成 + 图片尺寸 + 多图分列 + 单选写值 + ZIP 结构
npm run test:render        # 映射区/导出面板的 DOM 结构断言
npm run test:ui            # 真实组件渲染断言（stub 掉 SDK 后直接渲染面板）
npm run preview:ui         # 生成 design-preview.html，浏览器里肉眼验收 7 个界面状态
npm run make:samples       # 生成 samples/ 下 4 个可视样例，可直接用 WPS 打开验证
```

`test:roundtrip` 跑的是真正的 round-trip：用写入器生成带图 xlsx（两种模式各一次）→ 用读取器解析回来 →
校验媒体文件、Content_Types、drawing/cellimages 结构、DISPIMG 公式细节、图片落点坐标、MIME 与表头，
并单独校验这几条路径：

- 「原图原尺寸」与「指定边长等比缩放」，且**两种嵌图模式（float / dispimg）都校验缩放是否生效**
- **多图分列**：同一行 3 张图分别锚定到「照片 / 照片2 / 照片3」三列，第二行 1 张图只占「照片」列
- **单选 / 多选写值**：必须产出 `{ id, text }` 结构；没有选项映射时才退回纯文本
- **空白工作表判定**：空列 / 空行 / 两者皆空的 sheet 都被跳过，1 列 1 行的保留

`test:render` 用 linkedom 在内存里跑 React，断言实际产出的 DOM：

- **映射区精简**：没有字母序号、没有「＋ 新建：」前缀、没有 `.map-dst`，存在 `.tk-*` 类型色块
- **类型胶囊合二为一**：存在 `.tk-btn` / `.tk-caret` / `.pop-anchor`，且映射行里**没有独立的 `<select>`**（旧的 `.type-select` 已清除）
- **进度动效**：存在 `.prog` / `.progress-gloss` / `.prog-pct` / `.prog-count`，导出用 `.prog-export`，无总量时走 `.spinning`
- **文件类型扩展**：类型清单 ≥ 8 种且含 `xlsx / xlsm / xls / csv`，`.ftype` 徽章数量与类型表一致、zip 类型带 `.rich`
- **反馈入口**：`.brand-feedback` 可点击；点开后弹层含 `009176`、`@张强`（`.fb-at`）、插件描述（`.fb-appdesc`）、「复制反馈模板」，且**不含**「打开飞书会话」，由 `.pop-panel` 承载
- **空白工作表跳过**：`.sheet-skip-tag` 列出被跳过的表名、提示含「已跳过」、`.sheet-block` 数量等于真实 sheet 数
- **导出选项层级**：「图片边长」独占一个 `.opt-row`（与「全部图片都导出」同级），且**不在** `.opt-group` 内

`test:ui` 通过 `--alias` 把 `@lark-base-open/js-sdk` 换成 `test/stub-sdk.ts`，
**直接渲染真实的面板组件**（`App` / `ImportPanel` / `ExportPanel`），覆盖上面那套「复刻结构」测不到的部分：

- **步骤条**：`.step.done` / `.step.cur` 在 `current = 0/1/2` 各阶段正确；传 `current = items.length` 时三步全 `done` 且无 `cur`
- **hero 空态**：未选文件时渲染 `.hero` + `.hero-art`（SVG 图标）+ `<h2>`，且此时**不**渲染完成页与底部栏
- **环形进度**：`.ring-bg` + `.ring-fg` 两段圆环、按 `done/total` 算出百分比、`aria-valuenow` 正确；不确定态加 `.spinning` 显示 `—` 且不暴露 `aria-valuenow`
- **完成态**：`.success-wrap` / `.success-ring` / `.stat-grid` 4 格 / `.done-actions` / `.note-line`
- **回归护栏**：没有 `<table>`、拖放区与 file input 仍在、「表头在第 N 行」「重新解析」「导入选项」入口未丢

> 注意 1：`Popover` 的内容是**打开后才挂载**的，所以测弹层断言前必须先 `click()` 触发器再 `act()` 冲刷一次。
> 注意 2：`.pop-panel` 必须显式给不透明背景，否则弹层会和页面文字透叠（这正是本轮修的 bug），样式见 `styles.css` 的 `.pop-panel`。
> 注意 3：`test/render.ts` 是「复刻结构」式的断言，改了真实组件它不会跟着变 —— 新增 UI 请优先补 `test/ui.ts`。

`test/preview.ts`（`npm run preview:ui`）用 `renderToStaticMarkup` 把 7 个界面状态
渲进 400px 宽的 iframe，产出一个 `design-preview.html`，用于改版后快速肉眼验收。

`test/compare-wps.py` 会把本插件产出与**真实 WPS 产出的工作簿**做结构比对（需要机器上有 WPS 存过的含图文件），
用于防回归 —— 写 DISPIMG 那四个坑就是靠它定位的。

## 八、技术选型说明

- **`xlsx`(SheetJS) + `jszip`**：不用 ExcelJS。ExcelJS 的图片能力更全，但在浏览器打包时会拖进 `Buffer` / `process` polyfill，插件 iframe 里容易翻车。自己用 JSZip + 正则读写 xlsx 内部那几个部件，行为在浏览器和 Node 里完全一致，因此才能写出上面那个可跑的 round-trip 测试。
- **不依赖任何后端**：附件上传直接用 SDK 的 `bitable.base.batchUploadFile`，全部在前端完成。
