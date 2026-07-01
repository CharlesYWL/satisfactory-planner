#!/usr/bin/env python3
"""Normalize SCIM en-Stable.json into a clean dataset for the planner.
Outputs: data.normalized.json with items, buildings, recipes (forward-indexed).
"""
import json, re, sys, os

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'scim-en-stable.json')
OUT = os.path.join(HERE, 'data.normalized.json')
# 本地图标目录（相对仓库根 public/icons）。SCIM CDN 有 hotlink 防盗链，见 commit 9e8cf5b：
# 只保留已下载到 public/icons 的图标，其余图片字段留空（运行时 <img onError> 优雅降级）。
ICON_DIR = os.path.join(HERE, '..', 'public', 'icons')

d = json.load(open(SRC))
R = d['recipesData']; B = d['buildingsData']; I = d['itemsData']

def short(cls):
    # /Game/.../Desc_Stator.Desc_Stator_C -> Desc_Stator_C
    if not cls:
        return ''
    tail = cls.split('.')[-1]
    return tail

def local_icon(prefix, sid):
    # items -> icons/i_<id>.png、buildings -> icons/b_<id>.png（仅当文件已本地打包时）。
    fn = '%s_%s.png' % (prefix, sid)
    return 'icons/%s' % fn if os.path.exists(os.path.join(ICON_DIR, fn)) else ''

# --- Items ---
items = {}
ore_categories = {'ore'}
for ck, iv in I.items():
    sid = short(ck)
    items[sid] = {
        'id': sid,
        'name': iv.get('name', sid),
        'category': iv.get('category', ''),
        'color': iv.get('color', '#888888'),
        'image': local_icon('i', sid),
        'sinkPoints': iv.get('resourceSinkPoints', 0),
        'isRaw': iv.get('category', '') == 'ore',  # refined below
    }

# Known raw resources (ores, liquids, gases that are extracted, not crafted)
RAW = {
    'Desc_OreIron_C','Desc_OreCopper_C','Desc_Stone_C','Desc_Coal_C','Desc_OreGold_C',
    'Desc_Sulfur_C','Desc_OreBauxite_C','Desc_OreUranium_C','Desc_RawQuartz_C',
    'Desc_LiquidOil_C','Desc_Water_C','Desc_NitrogenGas_C','Desc_SAM_C',
}

# --- Buildings ---
buildings = {}
for bk, bv in B.items():
    sid = short(bk)
    buildings[sid] = {
        'id': sid,
        'name': bv.get('name', sid),
        'category': bv.get('category', ''),
        'power': bv.get('powerUsed', 0),
        'powerGenerated': bv.get('powerGenerated', 0),
        'image': local_icon('b', sid),
        'beltSpeed': bv.get('beltSpeed'),
        'extractionRate': bv.get('extractionRate'),
        # 物理入/出口数（原始 SCIM 字段）：Assembler input:2 output:1、Manufacturer input:4 output:1。
        # 施工图入口数据优先用它（比按配方原料种类数推更准），游戏更新后重跑本脚本自动更新。
        'input': bv.get('input'),
        'output': bv.get('output'),
    }

# Buildings we don't want as production machines (workbench/cart/quantum etc.)
SKIP_BUILD = {
    'BP_WorkshopComponent_C',  # craft bench (manual)
    'BP_BuildGun_C',
    'FGBuildableAutomatedWorkBench_C',
}

# --- Recipes (only automatable ones with a valid producing machine) ---
recipes = {}
for rk, rv in R.items():
    produced_in = [short(c) for c in (rv.get('mProducedIn') or []) if c]
    # keep only machine-automatable producers
    machines = [m for m in produced_in if m in buildings and m not in SKIP_BUILD]
    if not machines:
        continue
    ingredients = {short(k): v for k, v in (rv.get('ingredients') or {}).items()}
    produce = {short(k): v for k, v in (rv.get('produce') or {}).items()}
    if not produce:
        continue
    dur = rv.get('mManufactoringDuration', 0) or 0
    if dur <= 0:
        continue
    recipes[short(rk)] = {
        'id': short(rk),
        'name': rv.get('name', rk),
        'machines': machines,
        'duration': dur,
        'ingredients': ingredients,   # per cycle
        'produce': produce,           # per cycle
        'isAlternate': 'Alternate' in rk,
    }

# Mark raw items
for sid, it in items.items():
    if sid in RAW:
        it['isRaw'] = True

# Build reverse index: item -> [recipe ids that produce it]
producers = {}
for rid, r in recipes.items():
    for pid in r['produce']:
        producers.setdefault(pid, []).append(rid)

# Which items are produced by some recipe (i.e., craftable)
craftable = set(producers.keys())

out = {
    'branch': d.get('branch'),
    'items': items,
    'buildings': buildings,
    'recipes': recipes,
    'producers': producers,
    'raw': sorted(RAW),
}
json.dump(out, open(OUT, 'w'), ensure_ascii=False)

# --- Report ---
print('items:', len(items))
print('buildings:', len(buildings))
print('automatable recipes:', len(recipes))
print('  alternates:', sum(1 for r in recipes.values() if r['isAlternate']))
print('craftable items:', len(craftable))
print('items with NO recipe (raw/leaf):', len(items) - len(craftable))
print()
print('=== Stator producers ===')
for rid in producers.get('Desc_Stator_C', []):
    r = recipes[rid]
    ing = ', '.join('%s x%g' % (k, v) for k, v in r['ingredients'].items())
    prod = ', '.join('%s x%g' % (k, v) for k, v in r['produce'].items())
    print('  %s [%s] %ss | in: %s | out: %s | %s' % (
        rid, '/'.join(r['machines']), r['duration'], ing, prod,
        'ALT' if r['isAlternate'] else 'base'))
print()
print('=== sanity: items/min for base Stator ===')
r = recipes['Recipe_Stator_C']
permin = lambda q: q * 60 / r['duration']
print('  produce Stator/min:', permin(1))
print('  need SteelPipe/min:', permin(3), ' Wire/min:', permin(8))
