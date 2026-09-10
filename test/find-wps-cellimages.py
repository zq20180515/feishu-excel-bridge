"""扫描本机常见目录，找出真实 WPS 生成的含 xl/cellimages.xml 的工作簿，用于比对 ZIP 结构。"""
import os
import zipfile

ROOTS = [
    r"C:\Users\Administrator\Documents",
    r"C:\Users\Administrator\Desktop",
    r"C:\Users\Administrator\Downloads",
    r"C:\Users\Administrator\WorkBuddy",
]

found = []
for root in ROOTS:
    for dp, _dn, fn in os.walk(root):
        # 跳过 node_modules 等噪音
        if "node_modules" in dp:
            continue
        for f in fn:
            if not f.lower().endswith((".xlsx", ".xlsm")):
                continue
            p = os.path.join(dp, f)
            try:
                z = zipfile.ZipFile(p)
                names = z.namelist()
            except Exception:
                continue
            if "xl/cellimages.xml" in names:
                found.append((p, names))

print("含 cellimages.xml 的文件数:", len(found))
for p, names in found[:8]:
    print("---", p)
    for n in names:
        print("    ", n)
