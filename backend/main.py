
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
import tempfile
import os
import json
import h5py
import numpy as np
import pandas as pd
import shutil
import glob
import zipfile
import re

from trainer import (
    preview_dataset, start_train, get_status, get_result, list_models, delete_model,
    start_test, get_test_status, get_test_result,
    load_file_for_preview,
)


app = FastAPI()

from pydantic import BaseModel
import h5py

class DefectTypeRequest(BaseModel):
    path: str
    defectType: str



app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

current_file = None
current_zip = None
current_filename = "modified.nde"

@app.post("/upload")
async def upload(file: UploadFile = File(...)):
    global current_file
    global current_filename

    suffix = os.path.splitext(file.filename)[1]

    temp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)

    temp.write(await file.read())
    temp.close()

    if suffix.lower() == ".zip":
        global current_zip
        current_zip = temp.name
    else:
        current_file = temp.name

    current_filename = file.filename

    return {"message": "uploaded"}

def build_tree(group, path="/"):

    result = []

    for key in group.keys():

        obj = group[key]

        current_path = path + key

        if isinstance(obj, h5py.Group):

            result.append({
                "title": key,
                "key": current_path,
                "path": current_path,
                "children": build_tree(obj, current_path + "/")
            })

        else:

            result.append({
                "title": key,
                "key": current_path,
                "path": current_path,
                "isLeaf": True
            })

    return result

@app.get("/tree")
def tree():

    global current_file

    if current_file.endswith(".csv"):

        df = pd.read_csv(current_file)

        return [
            {
                "title": c,
                "key": c,
                "path": c,
                "isLeaf": True
            }
            for c in df.columns
        ]

    with h5py.File(current_file, "r") as f:
        return build_tree(f)

@app.get("/dataset")
def dataset(path: str):

    global current_file

    if current_file.endswith(".csv"):

        df = pd.read_csv(current_file)

        arr = df[path].values

        return {
            "type": "waveform",
            "shape": list(arr.shape),
            "dtype": str(arr.dtype),
            "data": arr[:4000].tolist()
        }

    with h5py.File(current_file, "r") as f:

        obj = f[path]

        attrs = {}

        for k, v in obj.attrs.items():
            attrs[k] = str(v)

        if isinstance(obj, h5py.Group):

            return {
                "type": "group",
                "children": list(obj.keys()),
                "attrs": attrs
            }

        data = obj[()]

        # bytes -> json pretty
        if isinstance(data, bytes):

            try:

                decoded = data.decode("utf-8")

                try:
                    parsed = json.loads(decoded)

                    return {
                        "type": "json",
                        **parsed,
                        "attrs": attrs
                    }

                except:

                    return {
                        "type": "text",
                        "data": decoded,
                        "attrs": attrs
                    }

            except:

                return {
                    "type": "bytes",
                    "data": str(data),
                    "attrs": attrs
                }

        if isinstance(data, np.ndarray):

            # 1D waveform
            if data.ndim == 1:

                return {
                    "type": "waveform",
                    "shape": list(data.shape),
                    "dtype": str(data.dtype),
                    "attrs": attrs,
                    "data": data[:4000].tolist()
                }

            # 2D image
            if data.ndim == 2:

                return {
                    "type": "image",
                    "shape": list(data.shape),
                    "dtype": str(data.dtype),
                    "attrs": attrs,
                    "image": data.tolist()
                }

            # NDE tensor [64,1,2000]
            if data.ndim == 3:

                squeezed = np.squeeze(data)

                if squeezed.ndim == 2:

                    return {
                        "type": "nde_tensor",
                        "shape": list(data.shape),
                        "squeezed_shape": list(squeezed.shape),
                        "dtype": str(data.dtype),
                        "attrs": attrs,
                        "bscan": squeezed.tolist(),
                        "ascan": squeezed[0].tolist()
                    }

            return {
                "type": "ndarray",
                "shape": list(data.shape),
                "dtype": str(data.dtype),
                "attrs": attrs,
                "preview": data.flatten()[:100].tolist()
            }

        return {
            "type": "scalar",
            "data": str(data),
            "attrs": attrs
        }

@app.post("/save_defect_type")
async def save_defect_type(req: DefectTypeRequest):

    print(
        "SAVE REQUEST",
        req.path,
        req.defectType
    )

    global current_file

    try:

        with h5py.File(current_file, "r+") as f:

            print(
                "OPEN DATASET",
                req.path
            )

            ds = f[req.path]
            print("SAVE PATH =", req.path)
            

            raw = ds[()]

            if isinstance(raw, bytes):

                obj = json.loads(
                    raw.decode("utf-8")
                )

                # obj["defectType"] = req.defectType
                # print(
                #     "OLD:",
                #     obj
                # )

                

                # ds[()] = json.dumps(
                #     obj,
                #     ensure_ascii=False
                # ).encode("utf-8")

                obj["defectType"] = req.defectType

                print(
                    "NEW JSON:",
                    obj
                )

                new_json = json.dumps(
                    obj,
                    ensure_ascii=False
                ).encode("utf-8")

                print(
                    "WRITE:",
                    new_json[:200]
                )

                ds[()] = new_json

                verify = ds[()]

                print(
                    "VERIFY:",
                    verify[:200]
                )

                print("SAVE DONE")

                return {
                    "success": True
                }

            return {
                "success": False,
                "error": "Dataset is not JSON bytes"
            }

    except Exception as e:

        return {
            "success": False,
            "error": str(e)
        }
    

@app.get("/download_nde")
def download_nde():
    global current_file
    global current_filename

    if current_file is None or current_filename is None:
        return {"error": "No file uploaded"}

    # 从原始文件名中替换 label
    import re

    # 假设文件名格式: CF_EP_Plate_WRUT_OK_Z409-20260602153945.nde
    # 找到中间的标签部分（OK / Dl / Db ...）
    new_label = None
    with h5py.File(current_file, "r") as f:
        # 尝试读取 /Private/GlobalLabel 的 defectType
        try:
            raw = f["/Private/GlobalLabel"][()]
            if isinstance(raw, bytes):
                obj = json.loads(raw.decode("utf-8"))
                new_label = obj.get("defectType", None)
        except:
            pass

    filename = current_filename
    if new_label:
        filename = re.sub(r'_(OK|Dl|Db|Po|Vo|In|Fb|Rs|Uc)_', f'_{new_label}_', filename)

    return FileResponse(
        path=current_file,
        filename=filename,
        media_type="application/octet-stream"
    )


@app.post("/batch_save_defect_type")
async def batch_save_defect_type(
    defectType: str = Form(...)
):
    import tempfile, zipfile, os, glob, h5py, json

    if not current_zip:
        return {"success": False, "error": "No ZIP uploaded"}

    work_dir = tempfile.mkdtemp()
    extract_dir = os.path.join(work_dir, "extract")
    os.makedirs(extract_dir)

    # 解压已上传的 ZIP
    with zipfile.ZipFile(current_zip, "r") as z:
        z.extractall(extract_dir)

    nde_files = glob.glob(os.path.join(extract_dir, "**", "*.nde"), recursive=True)
    updated = 0

    
    for nde in nde_files:
        try:
            # 修改内容
            with h5py.File(nde, "r+") as f:
                ds = f["/Private/GlobalLabel"]
                raw = ds[()]
                if isinstance(raw, bytes):
                    obj = json.loads(raw.decode("utf-8"))
                    obj["defectType"] = defectType
                    ds[()] = json.dumps(obj, ensure_ascii=False).encode("utf-8")
                    updated += 1

            # 关闭文件后再重命名
            dirname = os.path.dirname(nde)
            old_name = os.path.basename(nde)
            parts = old_name.split("_")
            labels = ["OK","Dl","Db","Po","Vo","In","Fb","Rs","Uc"]
            for i, p in enumerate(parts):
                if p in labels:
                    parts[i] = defectType
                    break
            new_name = "_".join(parts)
            os.rename(nde, os.path.join(dirname, new_name))

        except Exception as e:
            print("skip", nde, e)

    # 重新打包成 ZIP
    output_zip = os.path.join(work_dir, f"batch_{defectType}.zip")
    with zipfile.ZipFile(output_zip, "w", zipfile.ZIP_DEFLATED) as z:
        for root, _, files in os.walk(extract_dir):
            for file_name in files:
                full_path = os.path.join(root, file_name)
                arcname = os.path.relpath(full_path, extract_dir)
                z.write(full_path, arcname)

    return FileResponse(output_zip, filename=f"batch_{defectType}.zip", media_type="application/zip")


# ══════════════════════════════════════════════════
# 模型训练 API
# ══════════════════════════════════════════════════

@app.get("/train/preview")
def train_preview():
    return preview_dataset()


@app.post("/train/start")
def train_start(req: dict):
    job_id = start_train(req)
    return {"job_id": job_id, "status": "pending"}


@app.get("/train/status/{job_id}")
def train_status(job_id: str):
    return get_status(job_id)


@app.get("/train/result/{job_id}")
def train_result(job_id: str):
    res = get_result(job_id)
    if res is None:
        return {"error": "result not available yet"}
    return res


@app.get("/train/models")
def train_models():
    return {"models": list_models()}


@app.delete("/train/models/{model_name}")
def train_delete_model(model_name: str):
    delete_model(model_name)
    return {"success": True}


# ══════════════════════════════════════════════════
# 模型测试 API
# ══════════════════════════════════════════════════

@app.get("/test/models")
def test_models():
    return {"models": list_models()}


@app.post("/test/start")
def test_start(req: dict):
    job_id = start_test(req)
    return {"job_id": job_id, "status": "pending"}


@app.get("/test/status/{job_id}")
def test_status(job_id: str):
    return get_test_status(job_id)


@app.get("/test/result/{job_id}")
def test_result(job_id: str):
    res = get_test_result(job_id)
    if res is None:
        return {"error": "result not available yet"}
    return res


@app.get("/test/file_preview")
def test_file_preview(path: str):
    """加载 .nde 文件的 B-scan / A-scan 数据"""
    try:
        data = load_file_for_preview(path)
        return data
    except (ValueError, FileNotFoundError) as e:
        return {"error": str(e)}
    except Exception as e:
        return {"error": f"加载失败: {str(e)}"}


@app.get("/dataset_overview")
def dataset_overview():
    import re

    base = os.path.join(os.path.dirname(__file__), "..", "dataset")
    result = {
        "total_files": 0,
        "by_defect": {},   # OK: {count, files: [...]}
        "files": []
    }

    # 命名规则: {纤维类型}_{基体类型}_{结构}_{检测方法}_{缺陷类型}_{型号}_{时间戳}.nde
    pattern = re.compile(
        r"^(\w+)_(\w+)_(\w+)_(\w+)_(\w+)_(\w+)_(\d{14})_(.+)\.nde$"
    )

    if not os.path.isdir(base):
        return {"error": "dataset dir not found"}

    for defect_dir in sorted(os.listdir(base)):
        dir_path = os.path.join(base, defect_dir)
        if not os.path.isdir(dir_path):
            continue
        nde_list = [f for f in os.listdir(dir_path) if f.lower().endswith(".nde")]
        if not nde_list:
            continue

        files_info = []
        for fname in sorted(nde_list):
            m = pattern.match(fname)
            if m:
                files_info.append({
                    "filename": fname,
                    "fiber": m.group(1),
                    "matrix": m.group(2),
                    "structure": m.group(3),
                    "method": m.group(4),
                    "defect": m.group(5),
                    "model": m.group(6),
                    "timestamp": m.group(7),
                    "extra": m.group(8)
                })
            else:
                files_info.append({
                    "filename": fname,
                    "fiber": "-",
                    "matrix": "-",
                    "structure": "-",
                    "method": "-",
                    "defect": defect_dir,
                    "model": "-",
                    "timestamp": "-",
                    "extra": "-"
                })

        result["by_defect"][defect_dir] = {
            "count": len(files_info),
            "files": files_info
        }
        result["files"].extend(files_info)
        result["total_files"] += len(files_info)

    return result
