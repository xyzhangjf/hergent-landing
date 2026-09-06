import openpyxl, sys

PATH = "/Users/zhangjunfeng/Documents/舟谱导入模版/最新26年8月下单表8.18.xlsx"
wb = openpyxl.load_workbook(PATH, data_only=True, read_only=True)

print("SHEETS:", wb.sheetnames)

# 找含目标列的 sheet：优先含「永辉代码」或「分销价格」的
target_sheets = []
for ws in wb.worksheets:
    hdr = []
    for row in ws.iter_rows(min_row=1, max_row=1, values_only=True):
        hdr = [str(c).strip() if c is not None else "" for c in row]
        break
    joined = " ".join(hdr)
    if "永辉代码" in joined or "分销价格" in joined or "分销价" in joined:
        target_sheets.append((ws.title, hdr))

print("\nTARGET SHEETS:", [(t, h[:12]) for t, h in target_sheets])

# 选第一个目标 sheet 解析
if not target_sheets:
    print("NO TARGET SHEET FOUND")
    sys.exit(0)

title, hdr = target_sheets[0]
print(f"\n=== Using sheet: {title} ===")
print("HEADER:", hdr)

# 定位关键列索引
def idx(name_keys):
    for i, h in enumerate(hdr):
        for k in name_keys:
            if k in h:
                return i
    return -1

i_name = idx(["简称", "商品名称", "名称", "货品"])
i_code = idx(["永辉代码", "厂家编码", "产品编码"])
i_dist = idx(["分销价格", "分销价"])
i_barcode = idx(["条码", "条形码"])
i_spec = idx(["规格"])
print(f"col idx: name={i_name} code={i_code} dist={i_dist} barcode={i_barcode} spec={i_spec}")

rows_out = []
for r, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
    if i_name < 0 or i_name >= len(row):
        continue
    name = str(row[i_name]).strip() if row[i_name] is not None else ""
    if not name or name in ("合计", "小计", "总计"):
        continue
    code = str(row[i_code]).strip() if i_code >= 0 and i_code < len(row) and row[i_code] is not None else ""
    dist = row[i_dist] if i_dist >= 0 and i_dist < len(row) else None
    barcode = str(row[i_barcode]).strip() if i_barcode >= 0 and i_barcode < len(row) and row[i_barcode] is not None else ""
    spec = str(row[i_spec]).strip() if i_spec >= 0 and i_spec < len(row) and row[i_spec] is not None else ""
    if not code and dist is None:
        continue
    rows_out.append({"row": r, "name": name, "barcode": barcode, "spec": spec, "code": code,
                      "dist": float(dist) if dist not in (None, "") else None})

print(f"\nMAPPED ROWS: {len(rows_out)}")
for x in rows_out[:15]:
    print(x)
print("...")
print("with code:", sum(1 for x in rows_out if x['code']))
print("with dist:", sum(1 for x in rows_out if x['dist'] is not None))
