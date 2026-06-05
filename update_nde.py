import os
import json
import h5py

# ==================================================
# 配置
# ==================================================
DATASET_DIR = r"./dataset/TODO"

FIBER = "GF"
FIBER_GRADE = "FQW199"
MATRIX = "EP"
MATRIX_GRADE = "5224A"
METHOD = "WRUT"
STRUCTURE = "Taper"
DESCRIPTION = "黄色，jyqy隔板变厚度"  # 改这里
CODE = "Z409"  # 改这里

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
                "defect": False,
                "defectType": "OK",
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

        new_name = f"{name}_{FIBER_GRADE}_{MATRIX_GRADE}{ext}"
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