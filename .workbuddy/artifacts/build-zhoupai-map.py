import openpyxl, json

PATH = "/Users/zhangjunfeng/Documents/舟谱导入模版/最新26年8月下单表8.18.xlsx"
wb = openpyxl.load_workbook(PATH, data_only=True, read_only=True)

# 用最新周期：8月14报单-8月18到货（文件名 8.18 对应到货日）
SHEET = "8月14报单-8月18到货"
ws = wb[SHEET]
print("USING SHEET:", SHEET)

hdr = None
for row in ws.iter_rows(min_row=1, max_row=1, values_only=True):
    hdr = [str(c).strip() if c is not None else "" for c in row]
    break
def idx(keys):
    for i, h in enumerate(hdr):
        for k in keys:
            if k in h: return i
    return -1
i_name=idx(["简称","商品名称","名称"]); i_code=idx(["永辉代码","厂家编码","产品编码"])
i_dist=idx(["分销价格","分销价"]); i_barcode=idx(["条码","条形码"]); i_spec=idx(["规格"])

# 按条码合并（同名拆分商品条码相同），取首个 code/dist，dist 取该条码下最大（最新非空）
merged = {}  # barcode -> {name, code, dist, spec}
for r, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
    if i_name<0 or i_name>=len(row): continue
    name=str(row[i_name]).strip() if row[i_name] is not None else ""
    if not name or name in ("合计","小计","总计"): continue
    barcode=str(row[i_barcode]).strip() if i_barcode>=0 and i_barcode<len(row) and row[i_barcode] is not None else ""
    code=str(row[i_code]).strip() if i_code>=0 and i_code<len(row) and row[i_code] is not None else ""
    dist=row[i_dist] if i_dist>=0 and i_dist<len(row) else None
    spec=str(row[i_spec]).strip() if i_spec>=0 and i_spec<len(row) and row[i_spec] is not None else ""
    if not barcode and not name: continue
    key = barcode or name
    if key not in merged:
        merged[key] = {"name":name,"barcode":barcode,"code":code,"dist":None,"spec":spec}
    # dist：取最大值（避免被 0/空覆盖）
    if dist not in (None,""):
        try:
            dv=float(dist)
            if merged[key]["dist"] is None or dv>merged[key]["dist"]:
                merged[key]["dist"]=dv
        except: pass
    if not merged[key]["code"] and code: merged[key]["code"]=code
    if not merged[key]["spec"] and spec: merged[key]["spec"]=spec

print(f"合并后唯一商品(按条码/名称): {len(merged)}")
# 输出 JSON 供下步匹配
out=[]
for k,v in merged.items():
    out.append(v)
with open("/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/artifacts/zhoupai_codes.json","w") as f:
    json.dump(out,f,ensure_ascii=False,indent=1)
print("with code:", sum(1 for v in out if v['code']))
print("with dist:", sum(1 for v in out if v['dist'] is not None))
print("sample:", out[:3])
