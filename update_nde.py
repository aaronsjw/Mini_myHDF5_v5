import os
import json
import h5py
from sympy import true

# ==================================================
# 配置
# ==================================================
DATASET_DIR = r"./dataset/ascan_dataset/TODO"     # 要修改的目录

# # CF8611_AC531_ok，黑色，jyqy反射板
# FIBER = "CF"
# FIBER_GRADE = "CF8611"
# MATRIX = "EP"
# MATRIX_GRADE = "AC531 "
# METHOD = "WRUT"
# STRUCTURE = "Plate"
# DESCRIPTION = "CF8611_AC531_ok，黑色，jyqy反射板"   # 改这里
# CODE = "Z409"                       # 改这里
# # DEFECT = True                       # 是否有缺陷
# DEFECTTYPE = "OK"                   # 缺陷类型，标签

# # ok_黄_Z409_FQW199_5224A，jyqy隔板
# FIBER = "GFAF"
# FIBER_GRADE = "FQW199"
# MATRIX = "EP"
# MATRIX_GRADE = "5224A"
# METHOD = "WRUT"
# STRUCTURE = "Plate"
# DESCRIPTION = "黄_Z409_FQW199_5224A，jyqy隔板"   # 改这里
# CODE = "Z409"                       # 改这里
# DEFECTTYPE = "OK"                   # 缺陷类型，标签

# # 变厚度_黄_Z409_FQW199_5224A，jyqy隔板
# FIBER = "GFAF"
# FIBER_GRADE = "FQW199"
# MATRIX = "EP"
# MATRIX_GRADE = "5224A"
# METHOD = "WRUT"
# STRUCTURE = "Taper"
# DESCRIPTION = "变厚度_黄_Z409_FQW199_5224A，jyqy隔板"   # 改这里
# CODE = "Z409"                       # 改这里
# DEFECTTYPE = "OK"                   # 缺陷类型，标签

# # QW280是玻纤织物，1316是高温环氧，红色分层对比试块
# FIBER = "GF"
# FIBER_GRADE = "QW280"
# MATRIX = "EP"
# MATRIX_GRADE = "1316"
# METHOD = "WRUT"
# STRUCTURE = "Plate"
# DESCRIPTION = "红色分层对比试块，厚度4mm，分层，QW280是玻纤织物，1316是高温环氧"   # 改这里
# CODE = "Z409"                       # 改这里
# DEFECTTYPE = "Cp"                   # 缺陷类型，标签

# # 2#试块，板板胶接
# FIBER = "GF"
# FIBER_GRADE = "QW120"
# MATRIX = "EP"
# MATRIX_GRADE = "1316"
# METHOD = "WRUT"
# STRUCTURE = "BondPP"
# DESCRIPTION = "红色板板脱粘试块，厚度3mm+3mm，QW120/1316+QW120/1316"   # 改这里
# CODE = "Z109"                       # 改这里
# DEFECTTYPE = "Db"                   # 缺陷类型，标签

# # 3#试块混叠铺层，板板胶接，黑色入射
# FIBER = "CF"
# FIBER_GRADE = "ZT9H"
# MATRIX = "EP"
# MATRIX_GRADE = "1316"
# METHOD = "WRUT"
# STRUCTURE = "BondPP"
# DESCRIPTION = "混叠铺层板板胶接，黑色入射，ZT9H/1316+QW120/1316"   # 改这里
# CODE = "Z109"                       # 改这里
# DEFECTTYPE = "Db"                   # 缺陷类型，标签

# # 4#试块混叠铺层，板板胶接，QW280/1316+QW280/1316 
# FIBER = "GF"
# FIBER_GRADE = "QW280"
# MATRIX = "EP"
# MATRIX_GRADE = "1316"
# METHOD = "WRUT"
# STRUCTURE = "BondPP"
# DESCRIPTION = "混叠铺层板板胶接，QW280/1316+QW280/1316 "   # 改这里
# CODE = "Z109"                       # 改这里
# DEFECTTYPE = "Db"                   # 缺陷类型，标签

# # 5.翼尖分层试块，h1mm，QW280/1316
# FIBER = "GF"
# FIBER_GRADE = "QW280"
# MATRIX = "EP"
# MATRIX_GRADE = "1316"
# METHOD = "WRUT"
# STRUCTURE = "Plate"
# DESCRIPTION = "翼尖分层试块，红色，厚度1mm，QW280/1316"   # 改这里
# CODE = "Z109"                       # 改这里
# DEFECTTYPE = "Cp"                   # 缺陷类型，标签


# # 7.ZT9H/1316，厚8.6mm，碳纤维/高温环氧
# FIBER = "CF"
# FIBER_GRADE = "ZT9H"
# MATRIX = "EP"
# MATRIX_GRADE = "1316"
# METHOD = "WRUT"
# STRUCTURE = "Plate"
# DESCRIPTION = "厚8.6mm，碳纤维/高温环氧，黑色"   # 改这里
# CODE = "Z109"                       # 改这里
# DEFECTTYPE = "Cp"                   # 缺陷类型，标签

# # 8.QW280/AC319 3mm, QW280是石英织物，AC319是中温环氧。
# FIBER = "GF"
# FIBER_GRADE = "QW280"
# MATRIX = "EP"
# MATRIX_GRADE = "AC319"
# METHOD = "WRUT"
# STRUCTURE = "Plate"
# DESCRIPTION = "QW280/AC319 3mm, QW280是石英织物，AC319是中温环氧, 白色,0.3MPa"   # 改这里
# CODE = "Z109"                       # 改这里
# DEFECTTYPE = "OK"                   # 缺陷类型，标签

# 9.红色孔隙4块，QW120/1316,玻纤高温环氧 2mm，0.3MPa, 0.2MPa, 0.1MPa, -0.095MPa
FIBER = "GF"
FIBER_GRADE = "QW120"
MATRIX = "EP"
MATRIX_GRADE = "1316"
METHOD = "WRUT"
STRUCTURE = "Plate"
DESCRIPTION = "9#红色孔隙4块，QW120/1316 玻纤高温环氧 2mm，0.3MPa, 0.2MPa, 0.1MPa, =-0.095MPa"   # 改这里
CODE = "Z109"                       # 改这里
DEFECTTYPE = "Po"                   # 缺陷类型，标签



# ==================================================
# 创建 UTF8 JSON Dataset
# ==================================================
def create_json_dataset(group, name, obj):
    if name in group:
        del group[name]
    dt = h5py.string_dtype(encoding="utf-8")
    group.create_dataset(name, data=json.dumps(obj, ensure_ascii=False), dtype=dt)

# ==================================================
# 更新单个 NDE
# ==================================================
def update_nde_file(file_path):
    print("\nPROCESS:", file_path)
    try:
        with h5py.File(file_path, "r+") as f:
            # ======================================
            # Private Group
            # ======================================
            if "Private" not in f:
                private = f.create_group("Private")
            else:
                private = f["Private"]

            # ======================================
            # GlobalLabel
            # ======================================
            global_label = {
                "code": CODE,
                # "defect": DEFECT,
                "defectType": DEFECTTYPE,
                "description": DESCRIPTION,
                "frameFreq": 10,
                "method": METHOD,
                "probe_type": "5MHz water-bag focused",
                "structure": STRUCTURE
            }

            create_json_dataset(private, "GlobalLabel", global_label)

            # ======================================
            # MaterialInfo
            # ======================================
            material_info = {
                "fiber": FIBER,
                "fiberGrade": FIBER_GRADE,
                "matrix": MATRIX,
                "matrixGrade": MATRIX_GRADE
            }

            create_json_dataset(private, "MaterialInfo", material_info)

        # ======================================
        # 改文件名
        # ======================================
        dirname = os.path.dirname(file_path)
        basename = os.path.basename(file_path)
        name, ext = os.path.splitext(basename)

        # 已处理过则跳过
        if name.endswith(f"_{FIBER_GRADE}_{MATRIX_GRADE}"):
            print("Already renamed.")
            return

        # 生成新的文件名，使文件名和 GlobalLabel 内容一致
        # 格式示例：
        # GF_EP_Taper_WRUT_Dl_Z109-20260525150842_QW280_1316.nde

        # 取原文件名的 code 和时间戳部分
        if '-' in name:
            parts = name.split('-')
            prefix = parts[0]    # 原来的前缀，例如 CF_EP_Plate_WRUT
            timestamp = parts[1] # 时间戳，例如 20260528085743
        else:
            prefix = name
            timestamp = ''

        # 构建新的文件名前缀：材料_矩阵_结构_方法_缺陷类型_原code
        new_prefix = f"{FIBER}_{MATRIX}_{STRUCTURE}_{METHOD}_{DEFECTTYPE}_{CODE}"

        # 拼接完整文件名
        new_name = f"{new_prefix}_{timestamp}_{FIBER_GRADE}_{MATRIX_GRADE}{ext}"
        new_path = os.path.join(dirname, new_name)

        if os.path.exists(new_path):
            print("Target exists:", new_name)
        else:
            os.rename(file_path, new_path)
            print(f"RENAME:\n{basename}\n ->\n{new_name}")

    except Exception as e:
        print("ERROR:", file_path)
        print(e)

# ==================================================
# 扫描 dataset
# ==================================================
for root, dirs, files in os.walk(DATASET_DIR):
    for file in files:
        if file.lower().endswith(".nde"):
            update_nde_file(os.path.join(root, file))

print("\nDONE.")