#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v224 术语统一 pass-D：用户可见文案 + 事实性错注释收口。

pass-B 是盲替换，产生了三类需要人写的东西：
  ① **用户可见文案**里出现同义反复（「有进价的按进价算」「(进价或进价)」）；
  ② **自相矛盾**（「【进价】… 不是进价」「进价 ≡ 进价」）；
  ③ 我 pass-C 引入的「原厂价列 / 原进价列」措辞在**注释外**也泄漏了 —— 用户不该看到「厂价」二字。
统一原则：**用户可见文字只说「进价」；代码注释用 DB 列名 `factory_price` / `purchase_price` 消歧。**
每条锚点唯一，命中数不为 1（或非 0=已生效）即中止。
"""
import io
import sys

APPLY = "--apply" in sys.argv
FE = "/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/src/pages/"
BE = "/Users/zhangjunfeng/Documents/hergent-erp/server/"

PA = FE + "ProductArchive.vue"
FC = FE + "Forecast.vue"

FIXES = [
    # ============ ProductArchive.vue ============
    # ① 表头：两列合一
    (PA,
     '<th>品牌</th><th class="num">标准售价</th><th class="num">进价</th><th class="num" title="进价 ＝ 厂家结算价（同一个量，可留空按进价取）">进价</th><th class="num">安全库存</th><th>状态</th><th></th>',
     '<th>品牌</th><th class="num">标准售价</th><th class="num" title="进价 ＝ 厂家跟你结算的价（元/箱），算「本期需付款」用的就是它。可留空：留空则按档案里的历史进价列取；点格子可直接改">进价</th><th class="num">安全库存</th><th>状态</th><th></th>', 1),
    # ② 单元格：删掉原来那列进价，只留合并列
    (PA,
     '              <td class="num">{{ money(p.purchase_price) }}</td>\n              <td class="num pa-fp-cell">',
     '              <!-- 🔴 v224（2026-09-21）：此处原有**两列**（「进价」绑 `purchase_price`、\n'
     '                   「厂价」绑 `factory_price`），用户拍板「进价跟厂价是一个意思」⇒ **合成一列**。\n'
     '                   实测那 46 个两列都有值的商品上，`purchase_price` 与「分销价」「标准售价」\n'
     '                   **46/46 完全相同**，且门店真实成交价也是这个数 ⇒ 它存的是**卖给门店的价**，\n'
     '                   而 `factory_price` 才是厂家跟你结算的进货成本 ⇒ 留后者。\n'
     '                   ⚠️ `purchase_price` 仍在库里、仍作 `factory_price` 为空时的回退\n'
     '                      （见 `fpEff()`），只是不再单独成列。 -->\n'
     '              <td class="num pa-fp-cell">', 1),
    # ③ 单元格内部文案
    (PA,
     '                <!-- v165：进价 ⇒ 原进价列未单独录但进价有值时，直接显示口径解析后的价（不显示「未录」，\n'
     '                     否则用户会以为要重录一遍，而付款额其实已经在用进价）。 -->\n'
     '                <span v-else-if="fpEff(p).from === \'purchase\'" class="pa-fp-from" @click="startEditFp(p)"\n'
     '                      title="按口径「进价」取自进价；点这里也可单独填进价">取进价 {{ money(fpEff(p).v) }}</span>\n'
     '                <span v-else class="pa-fp-miss" title="点这里填进价（进价也为空）" @click="startEditFp(p)">未录</span>',
     '                <!-- v165/v224：档案进价列为空、但历史进价列有值时，直接显示解析后的价\n'
     '                     （不显示「未录」，否则用户会以为要重录一遍，而付款额其实已经在用那个值）。 -->\n'
     '                <span v-else-if="fpEff(p).from === \'purchase\'" class="pa-fp-from" @click="startEditFp(p)"\n'
     '                      title="取自档案里的历史进价列；点这里也可单独填一个进价">取进价 {{ money(fpEff(p).v) }}</span>\n'
     '                <span v-else class="pa-fp-miss" title="点这里填进价（档案里两个进价列都是空的）" @click="startEditFp(p)">未录</span>', 1),
    # ④ 页头按钮 title
    (PA,
     'title="进价 ≡ 厂家跟你结算的价（同一个量），用于算「本期需付款」。进价已有值的商品不必再补；这里可逐行填或用清单批量补">',
     'title="进价 ＝ 厂家跟你结算的价（元/箱），算「本期需付款」用的就是它。这里可逐行填，也可导出清单批量补">', 1),
    # ⑤ 到货周期注释里的价格组列举
    (PA,
     '之后、价格块之前 —— 它是 SKU 属性，不属于价格组（售价/进价/进价）。 -->',
     '之后、价格块之前 —— 它是 SKU 属性，不属于价格组（标准售价/进价/分销价）。 -->', 1),
    # ⑥ 编辑弹窗：两框合一
    (PA,
     '              <label class="pa-f"><span>进价</span><input v-model="editForm.purchase_price" class="input" type="number" min="0" step="0.01" placeholder="0"></label>\n'
     '              <label class="pa-f"><span>进价<span class="pa-hint">＝ 进价 ＝ 厂家结算价；留空 = 按进价</span></span><input v-model="editForm.factory_price" class="input" type="number" min="0" step="0.01" placeholder="留空 = 按进价"></label>',
     '              <!-- v224：原来这里有**两个**进价输入框（`purchase_price` / `factory_price`）——\n'
     '                   两词同义 ⇒ 只留一个（对外叫「进价」，绑 `factory_price`）。用户不必再猜该填哪个。\n'
     '                   ⚠️ `editForm.purchase_price` 仍留在数据里：保存走「只提交真的改过的字段」，\n'
     '                      没有界面入口 ⇒ 它永远不会进 payload，库里已有的值不会被覆盖或清零。 -->\n'
     '              <label class="pa-f"><span>进价<span class="pa-hint">厂家跟你结算的价（元/箱）；留空 = 按档案历史进价列取</span></span><input v-model="editForm.factory_price" class="input" type="number" min="0" step="0.01" placeholder="留空 = 按档案历史进价列取"></label>', 1),
    # ⑦ 新增弹窗：同上
    (PA,
     '              <label class="pa-f"><span>进价</span><input v-model="addForm.purchase_price" class="input" type="number" min="0" step="0.01" placeholder="0"></label>\n'
     '              <label class="pa-f"><span>进价<span class="pa-hint">＝ 进价，可留空</span></span><input v-model="addForm.factory_price" class="input" type="number" min="0" step="0.01" placeholder="0"></label>',
     '              <!-- v224：同编辑弹窗 —— 只留一个「进价」输入框（绑 factory_price）。 -->\n'
     '              <label class="pa-f"><span>进价<span class="pa-hint">厂家跟你结算的价（元/箱），可留空</span></span><input v-model="addForm.factory_price" class="input" type="number" min="0" step="0.01" placeholder="0"></label>', 1),
    # ⑧ 新增弹窗 payload：去掉无条件的 purchase_price（否则留空的输入框会把库里已有值清零）
    (PA,
     '      purchase_price: _num(f.purchase_price),\n'
     '      // 进价：空 = 「不动已录的进价」。本页新增同名商品会走 upsert 覆盖其它字段，\n'
     '      // 若把空值当 0 提交，会把用户补好的进价清零 —— 故只在真填了值时才带上该键。',
     '      // 🔴 v224：此处原为 `purchase_price: _num(f.purchase_price)`（**无条件**带键）。\n'
     '      //   界面已把两个进价输入框合成一个 ⇒ `f.purchase_price` 恒为空 ⇒ `_num("")` = 0\n'
     '      //   ⇒ 新增同名商品走 upsert 时会把库里已有的 `purchase_price` **清零**。\n'
     '      //   故本键改为**只在真填了值时才带**（与下面 factory_price 同一条守卫）。\n'
     '      ...(String(f.purchase_price).trim() === \'\' ? {} : { purchase_price: _num(f.purchase_price) }),\n'
     '      // 进价：空 = 「不动已录的进价」。本页新增同名商品会走 upsert 覆盖其它字段，\n'
     '      // 若把空值当 0 提交，会把用户补好的进价清零 —— 故只在真填了值时才带上该键。', 1),
    # ⑨ 补价面板说明
    (PA,
     '              <b>进价 ≡ 厂家跟你结算的价</b>（同一个量，档案里分成两列存）。它用于算「本期需付款 = 定稿量 × 进价」，\n'
     '              取价顺序为 <b>进价 → 标准售价</b>，所以<b>进价已有值的商品不必在这里重录</b>。<br>',
     '              <b>进价 ＝ 厂家跟你结算的价</b>（元/箱），用于算「本期需付款 = 定稿量 × 进价」。<br>\n'
     '              取值顺序：<b>档案进价 → 档案历史进价 → 标准售价</b>，所以<b>后两处已有值的商品不必在这里重录</b>。<br>', 1),
    (PA,
     '                  未开启：价格没录也能正常报单 —— 有进价的按进价算，<b>连进价都没有的才按标准售价估算（偏大）</b>。',
     '                  未开启：价格没录也能正常报单 —— 档案里有进价的按进价算，<b>连进价都没有的才按标准售价估算（偏大）</b>。', 1),
    # ⑩ 解析口径注释
    (PA,
     '// v132 曾把它另建成独立列 `factory_price`，与既有列 `purchase_price`（列头「进价」）同义；\n'
     '// 实测真实租户 `factory_price` 269/269 全空、价都在进价里 ⇒ 解析口径 = **取档案的进价（原进价列优先，缺则取原进价列）**，\n'
     '// 两者皆无才回退标准售价（偏大）。闸门开启后，连进价都没有的商品会在报单导入 / 小程序报单时被拒收。',
     '// v132 曾把它另建成独立列 `factory_price`，与既有列 `purchase_price` 同义（v224 起界面**只叫「进价」**、两列合一）。\n'
     '// 实测真实租户 `factory_price` 269/269 全空、价都在 `purchase_price` 里 ⇒ 解析口径 = **`factory_price` 优先，缺则取 `purchase_price`**，\n'
     '// 两者皆无才回退标准售价（偏大）。闸门开启后，两个进价列都没有的商品会在报单导入 / 小程序报单时被拒收。', 1),
    (PA,
     '// v165 进价口径：**进价 ＝ 厂家结算价（同一个量）** —— 用户 2026-09-14 定调。\n'
     '// v132 曾把进价另建成独立列 factory_price，实测真实租户 269/269 全空，价其实都在「进价」里。',
     '// v165 进价口径：`factory_price` 与 `purchase_price` 是**同一个量** —— 用户 2026-09-14 定调。\n'
     '// v132 曾把进价另建成独立列 factory_price，实测真实租户 269/269 全空，价其实都在 purchase_price 里。', 1),
    (PA,
     '//   进价列有值 → 用它（兼容历史上单独填过的租户）；否则取进价；两者皆无才视为缺价。',
     '//   factory_price 有值 → 用它（兼容历史上单独填过的租户）；否则取 purchase_price；两者皆无才视为缺价。', 1),
    (PA,
     ' *  ⚠️ 进价框显示的是**存储值**而不是列表列那个 `fpEff()` 解析值 —— 列表里「取进价 3.5」说的是\n'
     ' *  「进价没单独录，按口径用进价」，若在这里显示 3.5，用户会以为进价已录，保存时也会把 0 写成 3.5。 */',
     ' *  ⚠️ 进价框显示的是**存储值**（`factory_price`）而不是列表列那个 `fpEff()` 解析值 —— 列表里\n'
     ' *  「取进价 3.5」说的是「factory_price 没单独录，按口径用 purchase_price」，若在这里显示 3.5，\n'
     ' *  用户会以为已录，保存时也会把 0 写成 3.5。 */', 1),
    # ⑪ 修改日志字段名：两列必须可区分（否则留痕里两个「进价」）
    (PA,
     "  category: '分类', purchase_price: '进价', factory_price: '进价', dist_price: '分销价',",
     "  category: '分类', factory_price: '进价', purchase_price: '进价（历史字段）', dist_price: '分销价',", 1),
    # ⑫ 导出：`'进价'` 键出现两次（后者胜出）⇒ 删掉前者
    (PA,
     "      '标准售价': p.sale_price || 0, '进价': p.purchase_price || 0,\n"
     "      '进价': p.factory_price || 0, '分销价': p.dist_price || 0,",
     "      '标准售价': p.sale_price || 0,\n"
     "      // v224：原有两个中文键都叫「进价」（分别取 purchase_price / factory_price），\n"
     "      //   JS 对象里**后者覆盖前者** ⇒ 导出的一直是 factory_price。现只留一个键，行为不变。\n"
     "      '进价': p.factory_price || 0, '分销价': p.dist_price || 0,", 1),

    # ============ Forecast.vue ============
    (FC,
     '<p v-if="impFactoryMissing" class="imp-gate">没有识别到「进价」列。进价闸门开启时，档案里也没有进价（或进价）的行会被整行拒收 —— 文件里若有进价列，请在上表把它改成「进价」。</p>',
     '<p v-if="impFactoryMissing" class="imp-gate">没有识别到「进价」列。进价闸门开启时，档案里也没有进价的行会被整行拒收 —— 文件里若有这一列（旧模版里叫「厂价」），请在上表把它改成「进价」。</p>', 1),
    (FC,
     '              进价 ≡ 厂家跟你结算的价（同一个量）。请到 <b>商品档案 → 补进价</b> 补上',
     '              进价就是厂家跟你结算的价（元/箱）。请到 <b>商品档案 → 补进价</b> 补上', 1),
    (FC,
     '<b>进价</b>：商品档案填的进货价即进价，若另录进价则优先用它；<b>单价(进价/箱) = 商品档案的进价</b>（档案里的进价<b>本身就是「元/箱」</b>，不再乘任何换算）。',
     '<b>单价(进价/箱) = 商品档案的进价</b>（档案里的进价<b>本身就是「元/箱」</b>，不再乘任何换算）；档案进价为空时回退到档案里的历史进价列。', 1),
    (FC,
     '// v184d：删除「进价」列 —— 它与「单价(进价)」列显示的是**同一个数**（进价），',
     '// v184d：删除原「进价」列（绑 purchase_price）—— 它与「单价(进价)」列显示的是**同一个数**（v224 起两列合一），', 1),
    (FC,
     '// v184d：purchase_price（进价）权限随「进价」列一并移除 —— 列已不渲染，留着是死配置。',
     '// v184d：purchase_price 的列权限随该列一并移除（v224 起它已不单独成列）—— 列不渲染，权限是死配置。', 1),
    (FC,
     '// v184d：报单金额的计价基准 = 进价。口径与后端 db.factory_price_sql 逐字同构（进价）：',
     '// v184d：报单金额的计价基准 = 进价。口径与后端 db.factory_price_sql 逐字同构（两列同义，v224 界面只叫「进价」）：', 1),
    (FC,
     '// v184d：报单金额 / 单价口径统一为「进价」—— 与后端 db.factory_price_sql 逐字同构（进价）。',
     '// v184d：报单金额 / 单价口径统一为「进价」—— 与后端 db.factory_price_sql 逐字同构（两列同义）。', 1),
    (FC,
     '/* 进价是模版的「条件必填」列：闸门开启时缺进价（且档案无进价）的行会被整行拒收。',
     '/* 进价是模版的「条件必填」列：闸门开启时档案里没有进价的行会被整行拒收。', 1),
    (FC,
     '（取档案的进价：原厂价列优先、缺则取原进价列）不是同一个数：档案里「原厂价列 ≠ 原进价列」的商品，',
     '（`factory_price` 优先、缺则取 `purchase_price`）不是同一个数：档案里两列不相等的商品，', 1),

    # ============ 后端 ============
    (BE + "server.py",
     '# v157: 存量商品批量补进价 —— 进价（出进价）是 v132 新补的列，存量 SKU 全为 0，',
     '# v157: 存量商品批量补进价 —— 进价（factory_price）是 v132 新补的列，存量 SKU 全为 0，', 1),
    (BE + "erp_db.py",
     '# v132: 进价（出进价，厂家结算用）—— 2026-09-13 补。',
     '# v132: 进价（factory_price，厂家结算用）—— 2026-09-13 补。', 1),
    (BE + "erp_db.py",
     '# 进价是独立维护价：附件1 下单表 AK 列实证「进价 ≠ 分销价×规格×0.9」（该式仅 108/159 行成立，简爱系列全不成立）。',
     '# 进价是独立维护价：附件1 下单表 AK 列实证「factory_price ≠ 分销价×规格×0.9」（该式仅 108/159 行成立，简爱系列全不成立）。', 1),
    (BE + "routers/forecast.py",
     '# v165：进价 ⇒ 进价列未单独录时取档案「进价」（**不再掉到售价**）。',
     '# v165：factory_price 未单独录时取档案 purchase_price（**不再掉到售价**）。', 1),
    (BE + "routers/forecast.py",
     '"caliber": "进价优先（进价，即取档案进价）；两者皆无才回退标准售价"}}',
     '"caliber": "取商品档案的进价（factory_price 优先、缺则取 purchase_price）；连进价都没有才回退标准售价"}}', 2),
    (BE + "routers/forecast_submissions.py",
     '#   v165：回退链条已改为「进价 → 标准售价」三档（进价），',
     '#   v165：回退链条已改为「进价 → 标准售价」两档（v224 起 factory_price / purchase_price 视为同一列），', 1),
    (BE + "routers/forecast_submissions.py",
     '# v165：进价 ⇒ 档案侧取 fp_eff（`factory_price` 优先，缺则取进价），',
     '# v165：档案侧取 fp_eff（`factory_price` 优先，缺则取 `purchase_price`），', 1),
    (BE + "routers/forecast_config.py",
     '# 因此闸门判据与 missing_count 已统一改走 `db.factory_price_sql`（取档案的进价（原进价列优先，缺则取原进价列））：',
     '# 因此闸门判据与 missing_count 已统一改走 `db.factory_price_sql`（factory_price 优先，缺则取 purchase_price）：', 1),
    (BE + "routers/forecast_config.py",
     '"关掉则不拦（不影响任何已有数据）。进价，进价有值即不必再补。",',
     '"关掉则不拦（不影响任何已有数据）。两列同义，任一个有值即不必再补。",', 1),
    (BE + "routers/data.py",
     '            # v190：补发 `factory_price` —— 此前**漏发**，前端 `factoryPrice()` 只能回退进价，\n'
     '            #   与后端口径（`db.factory_price_sql`：取档案的进价（原进价列优先，缺则取原进价列））不是同一个数：\n'
     '            #   凡档案里「原厂价列 ≠ 原进价列」的商品，预报页的「单价(进价/箱)」与报单金额都与后端算的对不上。\n'
     '            #   另一个直接后果：用户在预报页手工录入进价、回写档案后，**页面自己读不回来**\n'
     '            #   （grid 不下发 ⇒ 行映射拿不到 ⇒ 又回退进价）⇒ 表现为「填了没生效」。',
     '            # v190：补发 `factory_price` —— 此前**漏发**，前端 `factoryPrice()` 只能回退 purchase_price，\n'
     '            #   与后端口径（`db.factory_price_sql`：factory_price 优先、缺则取 purchase_price）不是同一个数：\n'
     '            #   凡档案里两列不相等的商品，预报页的「单价(进价/箱)」与报单金额都与后端算的对不上。\n'
     '            #   另一个直接后果：用户在预报页手工录入进价、回写档案后，**页面自己读不回来**\n'
     '            #   （grid 不下发 ⇒ 行映射拿不到 ⇒ 又回退 purchase_price）⇒ 表现为「填了没生效」。', 1),
    (BE + "db/queries/products.py",
     'v165：进价 ⇒ 只要进价有值就不算缺（口径同 `factory_price_sql`）。',
     'v165：两列同义 ⇒ 只要 `purchase_price` 有值就不算缺（口径同 `factory_price_sql`）。', 1),
    (BE + "db/queries/products.py",
     '"""待补进价清单（**导出模版用**）：启用商品里**连进价都没有**的（v165：进价）。',
     '"""待补进价清单（**导出模版用**）：启用商品里**连进价都没有**的（v165：两列同义）。', 1),
    (BE + "db/queries/prices.py",
     '"note": "厂家系统下单用；价取商品档案的进价（≡ 进价），不单独存",',
     '"note": "厂家系统下单用；价取商品档案的进价（v224 起界面只叫「进价」），不单独存",', 1),
]

accum = {}
fail = 0
plan = []
for path, old, new, expect in FIXES:
    try:
        src = accum.get(path) or io.open(path, encoding="utf-8").read()
    except Exception as e:
        print("!! 读不到 %s: %s" % (path, e))
        fail += 1
        continue
    n = src.count(old)
    if n not in (0, expect):
        print("!! 命中 %d（期望 %d）%s" % (n, expect, path.split("/")[-1]))
        print("     %s" % old.strip().split("\n")[0][:120])
        fail += 1
        continue
    if n == 0:
        print("-- 已生效，跳过：%s | %s" % (path.split("/")[-1], old.strip().split("\n")[0][:80]))
        continue
    accum[path] = src.replace(old, new)
    plan.append((path, n))

paths = sorted(set(p for p, _ in plan))
print("\n将改动文件 = %d   条目 = %d   锚点失败 = %d" % (len(paths), len(plan), fail))
if fail:
    print("[ABORT] 未写入。")
    sys.exit(1)
if APPLY:
    for p in paths:
        io.open(p, "w", encoding="utf-8").write(accum[p])
    print("[APPLIED] %d 个文件" % len(paths))
else:
    print("[DRY-RUN] 未写入。")
