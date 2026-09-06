"""
CScan 单文件夹处理脚本：统一改名 + 生成边车 JSON

用法：处理新文件夹时，修改下面的 BASE、MAPPING、COMMON、FILES 四段，然后运行。
- BASE：目标文件夹绝对路径（注意：含中文，用原始字符串 r"..."）
- MAPPING：(旧文件名, 新文件名) 列表，旧名必须与磁盘完全一致
- COMMON：该文件夹所有图共用的元数据
- FILES：每张图各自的元数据（与 MAPPING 顺序对应）

命名规则：{方法}_{结构}_{缺陷}_{部件}_{探头}_{序号}.ext
方法: WRUT 反射 / WPUT 水穿透 / AUT 空耦 / PAUT 相控阵
结构: Plate 平板 / BondPP 板板胶接 / BondSC 板芯胶接
缺陷: Dl 分层 / Db 脱粘 / Po 孔隙 ...
"""
import os, json

# ════════════ 每文件夹改这几段 ════════════
BASE = r"F:\Learn\learn_torch\test\Mini_myHDF5_v5\dataset\cscan_dataset\超声C扫\超声C扫_穿透_冲击损伤_空耦穿透"

# (旧文件名, 新文件名)
MAPPING = [
    ("喷水穿透_平板_分层_1M探头_型号SYJ_补充信息20230320击穿试块--设备是空耦穿透1M探头16.7dB.png",
     "AUT_Plate_Dl_击穿试块_1M_01.png"),
    ("喷水穿透_平板_分层_5M探头_型号SYJ_补充信息20230320击穿试块-设备是空耦穿透-5M探头39dB.png",
     "AUT_Plate_Dl_击穿试块_5M_01.png"),
]

# 该文件夹所有图共用的元数据
COMMON = {
    "method": "AUT",           # 空耦穿透（文件名前缀写"喷水穿透"，按空耦归类）
    "structure": "Plate",      # 平板
    "defectType": "Dl",        # 分层
    "code": "SYJ",
    "damage_label": "冲击损伤",   # 并入 description 的前缀（无则留空）
}

# 每张图各自的元数据（顺序与 MAPPING 对应）
FILES = [
    {"probe_type": "1M water through-transmission", "gain": "16.7dB"},
    {"probe_type": "5M water through-transmission", "gain": "39dB"},
]
# ════════════ 以下不用改 ════════════

for (old, new), extra in zip(MAPPING, FILES):
    oldp = os.path.join(BASE, old)
    newp = os.path.join(BASE, new)
    if not os.path.exists(oldp):
        print(f"⚠️ 找不到旧文件: {old}")
        continue
    if os.path.exists(newp):
        print(f"⚠️ 目标已存在，跳过: {new}")
        continue

    # 1. 改名
    os.rename(oldp, newp)

    # 2. 生成边车 JSON
    parts = [p for p in (COMMON.get("damage_label"), extra.get("gain")) if p]
    prefix = ("——".join(parts) + "——") if parts else ""
    meta = {**COMMON, **extra, "description": prefix + old}
    meta.pop("damage_label", None)   # 并入 description，不单独写
    meta.pop("gain", None)           # 并入 description，不单独写
    stem = os.path.splitext(new)[0]
    with open(os.path.join(BASE, stem + ".json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    print(f"✅ {new}")
    print(f"   边车: {stem}.json")
