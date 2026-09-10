"""把本插件产出的 DISPIMG 文件与真实 WPS 产出文件做结构比对，确认关键差异项已全部消除。"""
import re
import sys
import zipfile

PLUGIN = r"C:\Users\Administrator\WorkBuddy\2026-09-10-16-46-36\feishu-excel-bridge\samples\导出效果_WPS内嵌图.xlsx"
REAL = r"C:\Users\Administrator\Documents\YJWJ宝箱计数.xlsx"


def probe(path: str, label: str):
    z = zipfile.ZipFile(path)
    names = z.namelist()
    ci = z.read("xl/cellimages.xml").decode("utf-8")
    ci_rels = z.read("xl/_rels/cellimages.xml.rels").decode("utf-8")
    wb_rels = z.read("xl/_rels/workbook.xml.rels").decode("utf-8")
    ct = z.read("[Content_Types].xml").decode("utf-8")

    # 找任意一个 DISPIMG 单元格
    disp = None
    for n in names:
        if re.match(r"xl/worksheets/sheet\d+\.xml$", n):
            s = z.read(n).decode("utf-8")
            m = re.search(r"<c [^>]*>(?:(?!</c>).)*?DISPIMG(?:(?!</c>).)*?</c>", s, re.S)
            if m:
                disp = m.group(0)
                break

    print(f"########## {label} ##########")
    print(f"  ZIP 首个条目          : {names[0]}")
    print(f"  含显式目录条目        : {sum(1 for n in names if n.endswith('/'))} 个")
    print(f"  cellimages 命名空间   : {re.search(r'xmlns:etc=.(https?://[^\"]+)', ci).group(1)}")
    m = re.search(r'<a:ext cx="(\d+)" cy="(\d+)"/>', ci)
    print(f"  首个图片 a:ext        : {m.group(0) if m else '无'}")
    print(f"  cellimages rels Target: {re.search(r'Target=.([^\"]+)', ci_rels).group(1)}")
    print(f"  workbook rels 类型    : {'WPS cellImage ✔' if 'wps.cn/officeDocument/2020/cellImage' in wb_rels else '❌ 缺失'}")
    print(f"  Content_Types Override: {'cellimage+xml ✔' if 'vnd.wps-officedocument.cellimage+xml' in ct else '❌ 缺失'}")
    print(f"  DISPIMG 单元格        : {disp}")
    if disp:
        print(f"    └ _xlfn. 前缀       : {'✔' if '_xlfn.DISPIMG' in disp else '❌'}")
        print(f"    └ <v> 非空缓存值    : {'✔' if re.search(r'<v>=DISPIMG', disp) else '❌'}")
    print()
    return z


probe(REAL, "真实 WPS 产出（参照基准）")
probe(PLUGIN, "本插件产出")
print("比对完成")
