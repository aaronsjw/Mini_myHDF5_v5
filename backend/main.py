
"""
后端核心源代码
API路由与业务逻辑
"""
from fastapi import FastAPI, UploadFile, File, Form             # 文件上传，表单
from fastapi.responses import FileResponse, StreamingResponse   # 返回文件，流式响应
from fastapi.middleware.cors import CORSMiddleware              # 跨域资源共享
import tempfile         # 临时文件
import os
import json
import re               # 正则
import h5py
import numpy as np
import pandas as pd
import shutil           # 高级文件操作
import glob
import zipfile
import re
from datetime import datetime

## 模型训练
from trainer import (
    preview_dataset,        # 预览数据集
    start_train,            # 启动训练
    get_status,             # 获取训练状态
    get_result,             # 获取训练结果
    list_models, delete_model,
    start_test,             # 启动测试
    get_test_status, 
    get_test_result,
    load_file_for_preview,
    generate_inspection_report,     # 生成检测报告
    parse_dispatch_doc,             # 解析委托单
    predict_single_file,            # 单文件预测
)

## 信号处理
from signal_analysis import analyze_signal, load_nde_meta, analyze_waveform_per_frame, analyze_waveform_keypoints
## 大模型交互
from deepseek_client import chat_stream
## 验收判定
from acceptance_checker import AcceptanceChecker
## CScan YOLO 推理
from cscan_yolo import (
    ultralytics_available, list_cscan_models, analyze_cscan,
    build_cscan_features, V5_ABBR_TO_ZH,
)
## CScan 原图入库 / 标注（切片与类表）
from cscan_ingest import (
    read_classes, add_class, normalize_stem, slice_raw_image,
    find_raw_image, parse_yolo, CODE_ZH,
)
## CScan YOLO 训练 / 验证评估（web 后台任务）
from cscan_trainer import (
    start_cscan_train, get_cscan_train_status, get_cscan_train_result,
    start_cscan_eval, get_cscan_eval_status, get_cscan_eval_result,
    list_cscan_model_meta, RUNS_DIR, MODELS_DIR as CSCAN_MODELS_DIR_T,
    PRETRAINED as CSCAN_PRETRAINED,
)
## 提示词模板
from prompts import (
    build_system_prompt, build_no_file_prompt,
    build_dataset_block, build_acceptance_index_block, build_acceptance_result_block,
    build_dispute_block, build_dispatch_block, build_local_model_content,
    build_cscan_block,
)

## 请求体模型
from pydantic import BaseModel      # 前后端交互的数据规范化
class DefectTypeRequest(BaseModel):
    path: str           # hdf5文件内部路径，对应json节点
    defectType: str     # 缺陷类型（OK/Dl/...）

## 创建应用实例
#   uvicorn main:app --reload   导入main模块，取出app变量
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],    # 允许跨域
    allow_methods=["*"],
    allow_headers=["*"],
)

current_file = None
current_zip = None
current_filename = "modified.nde"
current_dispatch_data = {}  # 委托单数据


# ══════════════════════════════════════════════════
# 1.文件上传与HDF5解析
# ══════════════════════════════════════════════════
# region 文件上传与HDF5解析

# 上传文件
@app.post("/upload")
async def upload(file: UploadFile = File(...)):
    
    # 上传文件的临时内存路径
    global current_file
    global current_filename

    suffix = os.path.splitext(file.filename)[1]

    temp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)     # 临时文件 TODO:如何清理
    temp.write(await file.read())   # 异步读取全部文件内容
    temp.close()

    if suffix.lower() == ".zip":
        global current_zip
        current_zip = temp.name
    else:
        current_file = temp.name

    current_filename = file.filename

    return {"message": "uploaded", "file_path": current_file, "filename": current_filename}

# 递归建树
def build_tree(group, path="/"):
    result = []
    for key in group.keys():
        obj = group[key]
        current_path = path + key
        # h5py.Group
        if isinstance(obj, h5py.Group):
            result.append({
                "title": key,
                "key": current_path,
                "path": current_path,
                "children": build_tree(obj, current_path + "/")
            })
        # Dataset            
        else:
            result.append({
                "title": key,
                "key": current_path,
                "path": current_path,
                "isLeaf": True
            })
    return result

# 文件上传后，解析层级结构，返回JSON
@app.get("/tree")
def tree():
    global current_file

    # CSV
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

# 前端点击tree节点，传入path，后端接收path，返回对应的json
@app.get("/dataset")
def dataset(path: str):

    global current_file

    # CSV文件
    if current_file.endswith(".csv"):
        df = pd.read_csv(current_file)
        arr = df[path].values
        return {
            "type": "waveform",
            "shape": list(arr.shape),
            "dtype": str(arr.dtype),
            "data": arr[:4000].tolist()     # TODO:2000点
        }

    # nde文件
    with h5py.File(current_file, "r") as f:

        obj = f[path]
        attrs = {}      # 节点上的元数据属性
        for k, v in obj.attrs.items():
            attrs[k] = str(v)

        # Group分支，返回“目录+子项名字”
        if isinstance(obj, h5py.Group):
            return {
                "type": "group",
                "children": list(obj.keys()),
                "attrs": attrs
            }

        # bytes分支，处理json元数据
        data = obj[()]

        # bytes -> json pretty
        if isinstance(data, bytes):
            try:
                decoded = data.decode("utf-8")      # 二进制→字符串
                try:
                    # bytes->json
                    parsed = json.loads(decoded)
                    return {
                        "type": "json",
                        **parsed,
                        "attrs": attrs
                    }
                except:
                    # bytes->text
                    return {
                        "type": "text",
                        "data": decoded,
                        "attrs": attrs
                    }
            except:
                # bytes解码失败，返回bytes
                return {
                    "type": "bytes",
                    "data": str(data),
                    "attrs": attrs
                }

        # ndarray分支
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
            # 其他，前100点
            return {
                "type": "ndarray",
                "shape": list(data.shape),
                "dtype": str(data.dtype),
                "attrs": attrs,
                "preview": data.flatten()[:100].tolist()
            }
        # 标量，单个数值
        return {
            "type": "scalar",
            "data": str(data),
            "attrs": attrs
        }

# 在json编辑器里修改全局标注defectType，写回nde文件的/Private/GlobalLabel节点
@app.post("/save_defect_type")
async def save_defect_type(req: DefectTypeRequest):

    print("SAVE REQUEST", req.path, req.defectType )
    global current_file

    try:
        with h5py.File(current_file, "r+") as f:
            print( "OPEN DATASET", req.path )
            ds = f[req.path]        # 按路径拿出dataset
            print("SAVE PATH =", req.path)
            raw = ds[()]            # 读原始值

            if isinstance(raw, bytes):
                obj = json.loads(raw.decode("utf-8"))   # bytes-str-dict
                obj["defectType"] = req.defectType      # 写入新
                print("NEW JSON:", obj)

                new_json = json.dumps(obj, ensure_ascii=False).encode("utf-8")
                print("WRITE:", new_json[:200])

                ds[()] = new_json   # 写回
                verify = ds[()]     # 读回验证
                print("VERIFY:", verify[:200])
                print("SAVE DONE")

                return { "success": True }

            return {
                "success": False,
                "error": "Dataset is not JSON bytes"
            }

    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }
    
# 全局标注修改后，下载
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
        filename = re.sub(r'_(OK|Dl|Db|Po|Ap|Vo|In|Fb|Rs|Uc)_', f'_{new_label}_', filename)

    return FileResponse(
        path=current_file,
        filename=filename,
        media_type="application/octet-stream"
    )

# endregion


# ══════════════════════════════════════════════════
# 2.缺陷标注系统
# ══════════════════════════════════════════════════
# region 缺陷标注系统

# 单帧标签
FRAME_LABEL_OPTIONS = [
    {"value": -1, "label": "未标注"},
    {"value": 0, "label": "无缺陷"},
    {"value": 1, "label": "分层"},
    {"value": 2, "label": "脱粘"},
    {"value": 3, "label": "孔隙"},
    {"value": 4, "label": "气孔"},
    {"value": 5, "label": "夹杂"},
    {"value": 6, "label": "纤维相关"},
    {"value": 7, "label": "富树脂"},
    {"value": 8, "label": "贫胶"},
    {"value": 9, "label": "耦合不良"},
    {"value": 10, "label": "噪音起始"},
    {"value": 11, "label": "噪音中止"},
    {"value": 12, "label": "波形过渡"},
    {"value": 13, "label": "不可分类"},
    {"value": 14, "label": "信号质量变化"},
    {"value": 15, "label": "胶膜孔隙"},
]

# 从 .nde 文件中探测波形数据的总帧数
def _get_n_frames_from_file(f: h5py.File) -> int:
    """从打开的 HDF5 文件中获取帧数"""
    for c in ["Public/Groups/0/Datasets/0-AScanAmplitude", "0-AScanAmplitude", "AScanAmplitude"]:
        if c in f:
            ds = f[c]
            if ds.ndim == 3:
                return ds.shape[0]
            if ds.ndim == 2:
                return ds.shape[0]
            return 64
    return 64

# 确保 HDF5 文件中存在Private/FrameLabels
def _ensure_frame_labels(f: h5py.File):
    """确保 Private/FrameLabels 存在且形状正确，返回 (dataset, n_frames)"""
    if "Private" not in f:
        f.create_group("Private")
    n = _get_n_frames_from_file(f)
    if "Private/FrameLabels" not in f:
        ds = f.create_dataset("Private/FrameLabels", (n,), dtype=np.int32, fillvalue=-1)
    else:
        ds = f["Private/FrameLabels"]
    return ds, n

# 自动标注算法
#   前端：好帧索引+相似度阈值
@app.post("/auto_label_frames")
def auto_label_frames(req: dict):
    """
    自动标注：以用户标记的 OK 帧为基准，对其他帧进行相似性判断。
    相似度 = 0.5×相关系数 + 0.15×均值差异 + 0.2×能量比 + 0.15×标准差比
    """
    global current_file
    if not current_file or not os.path.exists(current_file):
        return {"error": "没有已上传的文件"}

    # 前端：好帧索引+相似度阈值
    ok_idx = req.get("ok_frame_index")
    if ok_idx is None:
        return {"error": "缺少 ok_frame_index"}
    threshold = req.get("similarity_threshold", 0.85)

    try:
        waveform = analyze_waveform_per_frame(current_file)
        bscan = waveform["bscan"]
        n_frames = len(bscan)

        if ok_idx < 0 or ok_idx >= n_frames:
            return {"error": f"ok_frame_index 超出范围 (0-{n_frames-1})"}

        # 模板
        ok_wave = np.array(bscan[ok_idx])
        suggestions = []

        # 遍历每一帧，计算相似度
        for i in range(n_frames):
            wave_i = np.array(bscan[i])

            # 皮尔逊相关系数
            if np.std(wave_i) > 1e-8 and np.std(ok_wave) > 1e-8:
                corr = float(np.corrcoef(ok_wave, wave_i)[0, 1])
            else:
                corr = 0.0

            # 特征差异
            def _feat(w):
                return {"mean": float(np.mean(w)), "std": float(np.std(w)), "energy": float(np.sum(w**2))}

            f_ok = _feat(ok_wave)
            f_i = _feat(wave_i)

            mean_diff = 1 - min(abs(f_i["mean"] - f_ok["mean"]) / (abs(f_ok["mean"]) + 1e-6), 1)
            energy_ratio = min(f_i["energy"] / (f_ok["energy"] + 1e-6), f_ok["energy"] / (f_i["energy"] + 1e-6))
            std_ratio = min(f_i["std"] / (f_ok["std"] + 1e-6), f_ok["std"] / (f_i["std"] + 1e-6))

            similarity = corr * 0.5 + mean_diff * 0.15 + energy_ratio * 0.2 + std_ratio * 0.15
            similarity = max(0, min(1, similarity))

            # 根据相似度决定自动标签
            if i == ok_idx:
                auto_label = 0
                status = "reference"
            elif similarity >= threshold:
                auto_label = 0
                status = "auto_ok"
            else:
                auto_label = -1
                status = "pending"

            suggestions.append({"frame": i, "similarity": round(similarity, 4), "auto_label": auto_label, "status": status})

        # 自动保存到文件
        auto_labels = [s["auto_label"] for s in suggestions]
        try:
            with h5py.File(current_file, "r+") as f:
                ds, n = _ensure_frame_labels(f)
                for s in suggestions:
                    if s["auto_label"] == 0:
                        ds[s["frame"]] = 0
        except Exception:
            pass

        return {
            "auto_labels": auto_labels,
            "suggestions": suggestions,
            "n_frames": n_frames,
            "ok_frame_index": ok_idx,
            "threshold": threshold,
            "auto_ok_count": sum(1 for s in suggestions if s["status"] == "auto_ok"),
            "pending_count": sum(1 for s in suggestions if s["status"] == "pending"),
        }

    except Exception as e:
        return {"error": str(e)}

# 批量改zip的全局缺陷类型，/GlobalLabel/defectType，并且修改文件名
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
            labels = ["OK","Dl","Db","Po","Ap","Vo","In","Fb","Rs","Uc"]
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

# 从当前文件的/Private/FrameLabels，获取逐帧标签
@app.get("/get_frame_labels")
def get_frame_labels():
    """读取当前文件的逐帧标签"""
    global current_file
    if not current_file or not os.path.exists(current_file):
        return {"error": "没有已上传的文件"}
    try:
        with h5py.File(current_file, "r") as f:
            if "Private/FrameLabels" in f:
                labels = np.squeeze(f["Private/FrameLabels"][()]).tolist()
                if isinstance(labels, int):
                    labels = [labels]
                return {"labels": labels}
            else:
                n = _get_n_frames_from_file(f)
                return {"labels": [-1] * n}
    except Exception as e:
        return {"error": str(e)}

# 保存单帧标签
@app.post("/save_frame_label")
def save_frame_label(req: dict):
    """保存某一帧的标签"""
    global current_file
    frame_index = req.get("frame_index")
    label_id = req.get("label_id")

    if not current_file:
        return {"error": "没有已上传的文件"}
    if frame_index is None or label_id is None:
        return {"error": "缺少 frame_index 或 label_id"}

    try:
        with h5py.File(current_file, "r+") as f:
            ds, n = _ensure_frame_labels(f)
            ds[frame_index] = label_id
            return {"success": True, "frame_index": frame_index, "label_id": int(ds[frame_index])}
    except Exception as e:
        return {"error": str(e)}

# 保存多帧标签
@app.post("/save_frame_labels_batch")
def save_frame_labels_batch(req: dict):
    """批量保存帧标签"""
    global current_file
    labels = req.get("labels", {})

    if not current_file:
        return {"error": "没有已上传的文件"}
    if not labels:
        return {"error": "缺少 labels"}

    try:
        with h5py.File(current_file, "r+") as f:
            ds, n = _ensure_frame_labels(f)
            count = 0
            for frame_index, label_id in labels.items():
                ds[int(frame_index)] = int(label_id)
                count += 1
            return {"success": True, "saved_count": count}
    except Exception as e:
        return {"error": str(e)}

# 返回标签类型
@app.get("/label_options")
def label_options():
    """返回标签选项列表"""
    return {"options": FRAME_LABEL_OPTIONS}

# endregion


# ══════════════════════════════════════════════════
# 3.数据库概览
# ══════════════════════════════════════════════════
# region 数据库概览

def get_dataset_summary():
    """扫描 dataset/ 目录，返回数据集概要信息"""
    import re
    base = os.path.join(os.path.dirname(__file__), "..", "dataset", "ascan_dataset")
    if not os.path.isdir(base):
        return None

    pattern = re.compile(
        r"^(\w+)_(\w+)_(\w+)_(\w+)_(\w+)_(\w+)_(\d{14})_(.+)\.nde$"
    )

    defect_types = set()
    fibers = set()
    matrixes = set()
    structures = set()
    methods = set()
    total = 0
    by_defect = {}

    # 遍历子目录
    for defect_dir in sorted(os.listdir(base)):
        dir_path = os.path.join(base, defect_dir)
        if not os.path.isdir(dir_path):
            continue
        nde_files = [f for f in os.listdir(dir_path) if f.lower().endswith(".nde")]
        if not nde_files:
            continue

        count = 0
        for fname in nde_files:
            m = pattern.match(fname)
            if m:
                fibers.add(m.group(1))
                matrixes.add(m.group(2))
                structures.add(m.group(3))
                methods.add(m.group(4))
                defect_types.add(m.group(5))
            count += 1
        by_defect[defect_dir] = count
        total += count

    return {
        "total_files": total,
        "defect_types": sorted(defect_types),
        "by_defect": by_defect,
        "fibers": sorted(fibers),
        "matrixes": sorted(matrixes),
        "structures": sorted(structures),
        "methods": sorted(methods),
    }

# 生成数据集的概要统计
@app.get("/dataset_overview")
def dataset_overview():
    import re

    base = os.path.join(os.path.dirname(__file__), "..", "dataset", "ascan_dataset")
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

    # 遍历目录，子目录代表一种缺陷类型
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


# ── CScan 数据库概览 ──────────────────────────────────────────
CSCAN_RAW_DIR = os.path.join(os.path.dirname(__file__), "..", "dataset", "cscan_dataset", "raw")
CSCAN_IMAGE_EXTS = {".bmp", ".png", ".jpg", ".jpeg"}
_CSCAN_PATTERN = re.compile(
    r"^(\w+)_(\w+)_(\w+)_(\w+)_(\w+)_(\w+)_(\d{14})_(.+)\.(?:bmp|png|jpe?g)$",
    re.IGNORECASE,
)


def _read_cscan_sidecar(stem, base_dir=CSCAN_RAW_DIR):
    """读取与图片同名的边车 JSON（UTF-8，含中文 description）。
    缺失/解析失败 → 回退空 dict。"""
    p = os.path.join(base_dir, stem + ".json")
    if not os.path.isfile(p):
        return {}
    try:
        with open(p, encoding="utf-8") as f:
            d = json.load(f)
        return d or {}
    except Exception:
        return {}


def get_cscan_summary():
    """扫描 cscan_dataset/raw/，以边车 JSON 为权威字段，返回与
    get_dataset_summary() 同形的概要（后续可复用 build_dataset_block）。"""
    base = CSCAN_RAW_DIR
    if not os.path.isdir(base):
        return None

    defect_types, fibers, matrixes, structures, methods = set(), set(), set(), set(), set()
    total, by_defect = 0, {}

    for fname in sorted(os.listdir(base)):
        if os.path.splitext(fname)[1].lower() not in CSCAN_IMAGE_EXTS:
            continue
        meta = _read_cscan_sidecar(os.path.splitext(fname)[0], base)
        defect = meta.get("defectType") or "?"
        defect_types.add(defect)
        if meta.get("fiber"):      fibers.add(meta["fiber"])
        if meta.get("matrix"):     matrixes.add(meta["matrix"])
        if meta.get("structure"):  structures.add(meta["structure"])
        if meta.get("method"):     methods.add(meta["method"])
        by_defect[defect] = by_defect.get(defect, 0) + 1
        total += 1

    return {
        "total_files": total,
        "defect_types": sorted(defect_types),
        "by_defect": by_defect,
        "fibers": sorted(fibers),
        "matrixes": sorted(matrixes),
        "structures": sorted(structures),
        "methods": sorted(methods),
    }


@app.get("/cscan_dataset")
def cscan_dataset():
    """CScan 数据库概览：按缺陷类型分组，边车 JSON 为权威字段来源。
    返回形状与 /dataset_overview 兼容（DatabaseOverview 可复用），
    额外带 fiberGrade/matrixGrade/probe_type/description。"""
    base = CSCAN_RAW_DIR
    if not os.path.isdir(base):
        return {"error": "cscan raw dir not found"}

    result = {"total_files": 0, "by_defect": {}, "files": []}

    for fname in sorted(os.listdir(base)):
        if os.path.splitext(fname)[1].lower() not in CSCAN_IMAGE_EXTS:
            continue
        stem = os.path.splitext(fname)[0]
        meta = _read_cscan_sidecar(stem, base)
        m = _CSCAN_PATTERN.match(fname)

        info = {
            "filename":    fname,
            "fiber":       meta.get("fiber")      or (m.group(1) if m else "-"),
            "matrix":      meta.get("matrix")     or (m.group(2) if m else "-"),
            "structure":   meta.get("structure")  or (m.group(3) if m else "-"),
            "method":      meta.get("method")     or (m.group(4) if m else "-"),
            "defect":      meta.get("defectType") or (m.group(5) if m else "-"),
            "model":       meta.get("code")       or (m.group(6) if m else "-"),
            "timestamp":   m.group(7) if m else "-",
            "fiberGrade":  meta.get("fiberGrade")  or "-",
            "matrixGrade": meta.get("matrixGrade") or "-",
            "probe_type":  meta.get("probe_type")  or "-",
            "description": meta.get("description") or "-",
        }

        defect = info["defect"]
        result["by_defect"].setdefault(defect, {"count": 0, "files": []})
        result["by_defect"][defect]["files"].append(info)
        result["by_defect"][defect]["count"] += 1
        result["files"].append(info)
        result["total_files"] += 1

    if result["total_files"] == 0:
        return {"error": "cscan raw dir is empty"}
    return result


@app.get("/cscan/image")
def cscan_image(name: str):
    """返回 raw/ 下的 CScan 原图。文件名白名单校验防路径穿越。"""
    if not name or os.path.basename(name) != name:
        return {"error": "invalid filename"}
    path = os.path.join(CSCAN_RAW_DIR, name)
    if not os.path.isfile(path):
        return {"error": "image not found"}
    return FileResponse(path)

# endregion


# ══════════════════════════════════════════════════
# 4. CScan 图像智能检测 API (YOLO → 尺寸 → 验收)
# ══════════════════════════════════════════════════
# region CScan YOLO

def _best_ascan_prediction():
    """对已上传的 current_file(.nde) 跑 AScan 预测，返回
    (prediction_abbr, confidence, signal_features)；无文件/失败回退 (None, None, {})。
    缺陷类型的权威来源是 v5 AScan（YOLO 只管定位/尺寸）。"""
    if not current_file or not os.path.exists(current_file):
        return None, None, {}
    sig_features = {}
    try:
        sig = analyze_signal(current_file)
        sig_features = {k: v for k, v in sig.items() if isinstance(v, (int, float))} if sig else {}
        sig_features["detected_frames"] = 64
    except Exception:
        pass
    try:
        models = list_models()
        if not models:
            return None, None, sig_features
        pred = predict_single_file(current_file, models[0]["model_name"])
        if "error" in pred:
            return None, None, sig_features
        return pred.get("prediction"), pred.get("confidence"), sig_features
    except Exception:
        return None, None, sig_features


@app.get("/cscan/models")
def cscan_models():
    """可用 CScan YOLO 模型清单 + ultralytics 可用性。"""
    try:
        models = list_cscan_models()
    except Exception as e:
        return {"available": ultralytics_available(), "models": [], "note": str(e)}
    note = "ultralytics 未安装" if not ultralytics_available() else \
        ("未找到模型权重（backend/cscan_models 为空）" if not models else "")
    return {"available": ultralytics_available(), "models": models, "note": note}


@app.post("/cscan/analyze")
async def cscan_analyze(
    file: UploadFile = File(...),
    mm_per_px: float = Form(None),
    model: str = Form(None),
    conf: float = Form(0.35),
    iou: float = Form(0.45),
    standard_id: str = Form(None),
    grade: str = Form("C"),
):
    """CScan 图像分析：自动切块 YOLO 检测 → 物理尺寸 → 验收判定。

    返回 {cscan, v5_context, authoritative_*, merged_features, acceptance, discrepancy_warning}"""
    if not ultralytics_available():
        return {"error": "ultralytics 未安装（请用 cscan_env 运行后端）"}

    suffix = os.path.splitext(file.filename or "upload")[1].lower()
    if suffix not in CSCAN_IMAGE_EXTS:
        return {"error": f"仅支持图片格式: {sorted(CSCAN_IMAGE_EXTS)}"}

    # 解析模型名 → 权重路径
    model_path = model or ""
    if model_path:
        for m in list_cscan_models():
            if m["name"] == model_path or m["path"] == model_path:
                model_path = m["path"]
                break

    # 自动比例尺：若上传的是 raw 原图（文件名 stem 命中 raw/<stem>.json），
    # 边车里 mm_per_px（标尺标定）或 scan_w_mm/scan_h_mm（物理矩形）二选一，
    # 无需手工传 mm_per_px。显式传了 mm_per_px 则仍以其为准。
    physical_mm = None
    mm_from_meta = None
    if mm_per_px in (None, "", 0):
        stem0 = os.path.splitext(os.path.basename(file.filename or ""))[0]
        side = _read_cscan_sidecar(stem0)
        try:
            mmp = float(side.get("mm_per_px") or 0)
            if mmp > 0:
                mm_from_meta = mmp
        except (TypeError, ValueError):
            mm_from_meta = None
        if not mm_from_meta:
            try:
                wm = float(side.get("scan_w_mm") or 0)
                hm = float(side.get("scan_h_mm") or 0)
                if wm > 0 and hm > 0:
                    physical_mm = (wm, hm)
            except (TypeError, ValueError):
                physical_mm = None
    mm_in = mm_per_px if mm_per_px not in (None, "", 0) else mm_from_meta

    # 保存上传图片到临时文件并推理
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    tmp.write(await file.read())
    tmp.close()
    try:
        res = analyze_cscan(tmp.name, model_path=model_path, mm_per_px=mm_in,
                            physical_mm=physical_mm, conf=conf, iou=iou)
    except Exception as e:
        return {"error": f"CScan 分析失败: {e}"}
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass

    # ── 权威缺陷类型（v5 AScan 优先，YOLO 兜底/定位）──
    ascan_pred, ascan_conf, sig_features = _best_ascan_prediction()
    meta = {}
    try:
        if current_file and os.path.exists(current_file):
            meta = load_nde_meta(current_file) or {}
    except Exception:
        meta = {}

    detections = res["detections"]
    if ascan_pred and ascan_pred != "OK" and ascan_pred in V5_ABBR_TO_ZH:
        auth_abbr, auth_source = ascan_pred, "v5_ascan"
    elif detections:
        top = max(detections, key=lambda d: d["confidence"])
        auth_abbr, auth_source = top["class_name_en"], "yolo_map"
    else:
        auth_abbr, auth_source = (ascan_pred if ascan_pred in V5_ABBR_TO_ZH else ""), "v5_ascan"
    auth_type = V5_ABBR_TO_ZH.get(auth_abbr, "")

    # 类型不一致/AScan 判 OK 但 CScan 有检出 → 提示
    discrepancy = None
    det_abbrs = {d["class_name_en"] for d in detections}
    if ascan_pred:
        if ascan_pred == "OK" and detections:
            discrepancy = ("v5 AScan 判定为「无缺陷(OK)」，但 CScan 检出缺陷 "
                           f"{'/'.join(sorted(det_abbrs))}，建议人工复核")
        elif ascan_pred in V5_ABBR_TO_ZH and ascan_pred != auth_abbr and det_abbrs:
            discrepancy = (f"v5 AScan 判定为 {V5_ABBR_TO_ZH.get(ascan_pred, ascan_pred)}({ascan_pred})，"
                           f"CScan 检出的缺陷类别为 {'/'.join(sorted(det_abbrs))}，两者不一致，建议人工复核")

    # 合并特征：AScan 数值特征 + CScan 尺寸特征（仅保留标量，规则引擎只认标量）
    feats = dict(sig_features)
    feats.update(build_cscan_features(res["stats"], auth_abbr))
    merged = {k: v for k, v in feats.items()
              if isinstance(v, (int, float)) and not isinstance(v, bool)}

    # ── 验收判定（HB 尺寸/面积阈值 + grade）──
    acceptance = None
    try:
        checker = get_checker()
        if not standard_id:
            standard_id = checker.suggest_standard(meta)
        if not standard_id:
            idx = checker.get_index()
            standard_id = idx[0].get("id") if idx else None
        if standard_id and auth_abbr and auth_abbr != "OK":
            acceptance = checker.check(standard_id, {
                "defect_type": auth_type,
                "defect_type_en": auth_abbr,
                "confidence": ascan_conf or 0,
                "signal_features": merged,
                "grade": grade or "C",
                "prediction": {},
            })
    except Exception as e:
        acceptance = {"error": str(e)}

    v5_context = {
        "has_nde": bool(current_file and os.path.exists(current_file)),
        "filename": current_filename if (current_file and os.path.exists(current_file)) else "",
        "ascan_defect_type": V5_ABBR_TO_ZH.get(ascan_pred) if ascan_pred else None,
        "ascan_defect_abbr": ascan_pred,
        "ascan_confidence": ascan_conf,
    }

    return {
        "cscan": res,
        "v5_context": v5_context,
        "authoritative_defect_type": auth_type,
        "authoritative_defect_abbr": auth_abbr,
        "authoritative_source": auth_source,
        "merged_features": merged,
        "acceptance": acceptance,
        "discrepancy_warning": discrepancy,
    }

# endregion


# ══════════════════════════════════════════════════
# CScan 原图入库 / 标注（raw 三件套 + 自动切片）
# ══════════════════════════════════════════════════
# region CScan Ingest

CSCAN_DATASET_DIR = os.path.dirname(CSCAN_RAW_DIR)
CSCAN_IMAGES_DIR = os.path.join(CSCAN_DATASET_DIR, "images")
CSCAN_LABELS_DIR = os.path.join(CSCAN_DATASET_DIR, "labels")
CSCAN_META_DIR = os.path.join(CSCAN_DATASET_DIR, "meta")
CSCAN_CLASSES_TXT = os.path.join(CSCAN_RAW_DIR, "labels.txt")
CSCAN_CODES_JSON = os.path.join(CSCAN_DATASET_DIR, "codes.json")


def _cscan_class_list():
    """labels.txt 行序(=class_id) + codes.json/CODE_ZH 中文名，供标注下拉。"""
    codes = read_classes(CSCAN_CLASSES_TXT)
    zh = {}
    try:
        with open(CSCAN_CODES_JSON, encoding="utf-8") as f:
            for c in json.load(f):
                zh[c["code"]] = c.get("zh", c["code"])
    except Exception:
        pass
    return [{"id": i, "code": c, "zh": zh.get(c, CODE_ZH.get(c, c))} for i, c in enumerate(codes)]


@app.get("/cscan/classes")
def cscan_classes():
    """CScan 标注可用的缺陷类别（行号 = class_id）。"""
    try:
        return {"classes": _cscan_class_list(), "ok_class": "OK"}
    except Exception as e:
        return {"error": str(e)}


@app.post("/cscan/classes/add")
def cscan_classes_add(req: dict):
    """新增缺陷码：写 raw/labels.txt + codes.json，返回 id（已存在则返回旧 id）。"""
    try:
        code = str(req.get("code", "")).strip()
        nid = add_class(CSCAN_CLASSES_TXT, CSCAN_CODES_JSON, code, str(req.get("zh", "")).strip())
        return {"id": nid, "code": code}
    except Exception as e:
        return {"error": str(e)}


@app.get("/cscan/raw/item")
def cscan_raw_item(stem: str):
    """读 raw/ 某 stem 的边车 + 标注框，供"打开已有图续标"。"""
    if not stem or os.path.basename(stem) != stem:
        return {"error": "invalid stem"}
    img = find_raw_image(CSCAN_RAW_DIR, stem)
    if not img:
        return {"error": "raw 图不存在"}
    meta = _read_cscan_sidecar(stem, CSCAN_RAW_DIR)
    boxes = [{"class_id": c, "cx": cx, "cy": cy, "w": w, "h": h}
             for (c, cx, cy, w, h) in parse_yolo(os.path.join(CSCAN_RAW_DIR, stem + ".txt"))]
    return {"stem": stem, "filename": os.path.basename(img), "ext": os.path.splitext(img)[1].lower(),
            "meta": meta, "yolo": boxes, "has_txt": bool(boxes)}


@app.post("/cscan/raw/save")
async def cscan_raw_save(file: UploadFile = File(...),
                         meta: str = Form("{}"),
                         boxes: str = Form("[]")):
    """把一张未处理原图入库：规范命名存 raw 三件套 + 自动切片更新 images/labels/meta。

    multipart: file 原图；meta json(9 段字段 + probe_type/description/timestamp)；
    boxes json: [{class_id,cx,cy,w,h}]（归一化坐标，空数组 = 背景/无缺陷）。"""
    suffix = os.path.splitext(file.filename or "")[1].lower()
    if suffix not in CSCAN_IMAGE_EXTS:
        return {"error": f"仅支持图片: {sorted(CSCAN_IMAGE_EXTS)}"}
    try:
        m = json.loads(meta) if meta else {}
    except Exception:
        return {"error": "meta 不是合法 JSON"}
    try:
        box_list = json.loads(boxes) if boxes else []
    except Exception:
        return {"error": "boxes 不是合法 JSON"}

    for d in (CSCAN_IMAGES_DIR, CSCAN_LABELS_DIR, CSCAN_META_DIR):
        os.makedirs(d, exist_ok=True)

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    tmp.write(await file.read())
    tmp.close()
    try:
        stem = normalize_stem(m, fallback_mtime=datetime.fromtimestamp(os.path.getmtime(tmp.name)))

        # ① 原图 → raw/<stem><ext>（已存在则覆盖，即"编辑既有 raw"）
        dst = os.path.join(CSCAN_RAW_DIR, stem + suffix)
        shutil.copy2(tmp.name, dst)

        # ② 边车 json（含中文 description）
        with open(os.path.join(CSCAN_RAW_DIR, stem + ".json"), "w", encoding="utf-8") as f:
            json.dump(m, f, ensure_ascii=False, indent=2)

        # ③ 标注 → raw/<stem>.txt（YOLO 归一化行；空数组=背景图，写空文件标记已处理）
        lines = []
        for b in box_list:
            lines.append(f"{int(b['class_id'])} {float(b['cx']):.6f} {float(b['cy']):.6f} "
                         f"{float(b['w']):.6f} {float(b['h']):.6f}")
        with open(os.path.join(CSCAN_RAW_DIR, stem + ".txt"), "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + ("\n" if lines else ""))

        # ④ 自动切片（幂等清旧 tile）
        slice_res = slice_raw_image(stem, m, CSCAN_RAW_DIR,
                                    CSCAN_IMAGES_DIR, CSCAN_LABELS_DIR, CSCAN_META_DIR,
                                    read_classes(CSCAN_CLASSES_TXT))
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass
    return {"ok": True, "stem": stem, "filename": stem + suffix, "slice": slice_res}


# endregion


# ══════════════════════════════════════════════════
# 4.模型训练 API
# ══════════════════════════════════════════════════
# region 模型训练API

# 数据集统计 TODO:
@app.get("/train/preview")
def train_preview():
    return preview_dataset()

# 异步启动训练，立即返回job_id
@app.post("/train/start")
def train_start(req: dict):
    job_id = start_train(req)
    return {"job_id": job_id, "status": "pending"}

# 训练进度
@app.get("/train/status/{job_id}")
def train_status(job_id: str):
    return get_status(job_id)

# 训练结果
@app.get("/train/result/{job_id}")
def train_result(job_id: str):
    res = get_result(job_id)
    if res is None:
        return {"error": "result not available yet"}
    return res

# 列出已训练模型
@app.get("/train/models")
def train_models():
    return {"models": list_models()}

# 删除已训练模型
@app.delete("/train/models/{model_name}")
def train_delete_model(model_name: str):
    delete_model(model_name)    # 删pkl/pt+json
    return {"success": True}

# endregion


# ══════════════════════════════════════════════════
# 5.模型测试 API
# ══════════════════════════════════════════════════
# region 模型测试API

# 列出测试模型
@app.get("/test/models")
def test_models():
    return {"models": list_models()}

# 异步测试
@app.post("/test/start")
def test_start(req: dict):
    job_id = start_test(req)
    return {"job_id": job_id, "status": "pending"}

# 测试进度
@app.get("/test/status/{job_id}")
def test_status(job_id: str):
    return get_test_status(job_id)

# 测试结果
@app.get("/test/result/{job_id}")
def test_result(job_id: str):
    res = get_test_result(job_id)
    if res is None:
        return {"error": "result not available yet"}
    return res

# 预览单文件
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

# endregion


# ══════════════════════════════════════════════════
# 6. 智能评估 AI流式对话结果评估
# ══════════════════════════════════════════════════
# region 流式对话结果评估

# 信号波形查询
@app.get("/chat/signal_waveform")
def chat_signal_waveform():
    """返回当前文件的 A-Scan 全量波形数据和逐帧异常信息"""
    global current_file
    if not current_file or not os.path.exists(current_file):
        return {"error": "没有已上传的文件"}
    try:
        waveform = analyze_waveform_per_frame(current_file)
        signal = analyze_signal(current_file)
        keypoints_data = analyze_waveform_keypoints(current_file)
        waveform["abnormal_zone_positions"] = signal.get("abnormal_zone_positions", [])
        waveform["keypoints"] = keypoints_data.get("keypoints", [])
        return waveform
    except Exception as e:
        return {"error": f"分析失败: {str(e)}"}

# AI对话评估
@app.post("/chat/ask")
async def chat_ask(req: dict):
    """智能评估对话接口（SSE 流式）"""
    question = req.get("question", "").strip()
    model_name = req.get("model_name", "")
    ai_mode = req.get("ai_mode", "cloud")
    history = req.get("history", [])  # 多轮对话历史

    # 如果没有问题，返回空
    if not question:
        async def empty_gen():
            yield "\n__DONE__"
        return StreamingResponse(empty_gen(), media_type="text/plain")

    # 检测是否询问数据库信息
    dataset_keywords = ['数据库', '缺陷类型', '材料', '纤维', '基体', '结构', '检测方法',
                        '有哪些', '有什么', '几个缺陷', '多少文件', '数据集', 'data', '样本']
    asks_about_dataset = any(k in question for k in dataset_keywords)
    dataset_info = get_dataset_summary() if asks_about_dataset else None

    # 确定是否有上传文件
    has_file = current_file is not None and os.path.exists(current_file)

    if has_file:
        # 有文件：读取信号 + 模型预测
        try:
            signal = analyze_signal(current_file)
            meta = load_nde_meta(current_file)
        except Exception as e:
            signal = None
            meta = {}

        # 模型预测
        prediction = None
        if model_name:
            try:
                prediction = predict_single_file(current_file, model_name)
            except Exception as e:
                prediction = {"error": str(e)}
        else:
            # 自动选最好模型
            models = list_models()
            if models:
                best = models[0]
                model_name = best["model_name"]
                try:
                    prediction = predict_single_file(current_file, model_name)
                except Exception as e:
                    prediction = {"error": str(e)}

        # 提取元数据文本
        meta_lines = []
        if meta:
            gl = meta.get("GlobalLabel", {})
            mi = meta.get("MaterialInfo", {})
            di = meta.get("DetectionInfo", {})

            if gl.get("structure"): meta_lines.append(f"- 结构类型：{gl['structure']}")
            # 材料体系：纤维牌号/基体牌号（中文纤维增强中文基体基复合材料）
            fiber_zh = {"CF":"碳纤维","GF":"玻璃纤维","BF":"硼纤维","AF":"芳纶纤维","C/SiC":"碳/碳化硅"}.get(mi.get("fiber",""), mi.get("fiber",""))
            matrix_zh = {"EP":"环氧","BMI":"双马","PI":"聚酰亚胺","TP":"热塑","SiC":"碳化硅"}.get(mi.get("matrix",""), mi.get("matrix",""))
            fg = mi.get("fiberGrade", mi.get("fiber", ""))
            mg = mi.get("matrixGrade", mi.get("matrix", ""))
            if fg and mg:
                meta_lines.append(f"- 材料体系：{fg}/{mg}（{fiber_zh}增强{matrix_zh}基复合材料）")
            if di.get("probeFreq"): meta_lines.append(f"- 探头频率：{di['probeFreq']} MHz")
            if di.get("samplingFreq"): meta_lines.append(f"- 采样频率：{di['samplingFreq']} MHz")

        # 信号特征文本
        signal_lines = []
        if signal:
            signal_lines.append(f"- 幅值范围：[{signal['amp_range'][0]}, {signal['amp_range'][1]}]")
            signal_lines.append(f"- 信号能量：{signal['energy']}")
            signal_lines.append(f"- 信噪比（SNR）：{signal['snr_db']} dB")
            signal_lines.append(f"- 平均幅值：{signal['mean_amplitude']}")
            signal_lines.append(f"- 幅值标准差：{signal['std_amplitude']}")
            signal_lines.append(f"- 回波峰值位置：采样点 {signal['peak_location']}")
            signal_lines.append(f"- 底波能量比：{signal['backwall_ratio']}")
            signal_lines.append(f"- 衰减系数：{signal['attenuation']}")
            signal_lines.append(f"- 异常区域：{signal['abnormal_zone_desc']}")

        # 预测结果文本
        pred_lines = []
        if prediction and "error" not in prediction:
            pred_lines.append(f"- Top-1 预测：{prediction['prediction']}")
            pred_lines.append(f"- 置信度：{prediction['confidence']:.1%}")
            pred_lines.append(f"- Top-3：{', '.join(prediction['top3'])}")

            # 各类别概率详情
            prob_details = "、".join([
                f"{k}={v:.1%}" for k, v in sorted(
                    prediction['probabilities'].items(),
                    key=lambda x: x[1], reverse=True
                )
            ])
            pred_lines.append(f"- 各类别概率：{prob_details}")
            pred_lines.append(f"- 使用模型：{prediction['model_name']}")

        # 构造 system prompt
        system_prompt = build_system_prompt(meta_lines, signal_lines, pred_lines, prediction)

    else:
        # 无文件：通用助手指令
        system_prompt = build_no_file_prompt()
    # 如果询问数据库信息，追加数据集描述
    if dataset_info:
        system_prompt += build_dataset_block(dataset_info)

    # 验收标准相关查询（对话式）
    acceptance_keywords = ['验收', '验收标准', '验收文件', '超标', '合格判定', '验收判定', '标准文件']
    asks_acceptance = any(k in question for k in acceptance_keywords)
    acceptance_ctx = ""

    if asks_acceptance:
        try:
            checker = get_checker()
            idx = checker.get_index()
            if idx:
                acceptance_ctx = build_acceptance_index_block(idx)

                # 判断是否需要执行判定（用户问"依据XX标准是否超标"之类）
                do_check = any(k in question for k in ["超标", "合格", "判定", "依据", "按", "合不合格", "过不过"])
                target_id = None
                if do_check:
                    q_nospace = question.replace(" ", "")
                    for s in idx:
                        sid = s["id"]
                        sid_nospace = sid.replace(" ", "")
                        sid_num = sid.split("-")[0].split()[-1]  # "HB 7224-2020" → "7224"
                        # 多种匹配方式：精确、无空格、标准号数字、标准名称
                        if (sid in question or sid_nospace in q_nospace
                            or sid_num in q_nospace
                            or s.get("name", "") in question):
                            target_id = sid
                            break
                    if not target_id and idx:
                        target_id = idx[0].get("id")

                if target_id and current_file and os.path.exists(current_file):
                    sig = analyze_signal(current_file)
                    meta = load_nde_meta(current_file)
                    sf = {k: v for k, v in sig.items() if isinstance(v, (int, float))} if sig else {}
                    sf["detected_frames"] = 64
                    dt = (meta or {}).get("GlobalLabel", {}).get("defectType", "")
                    res = checker.check(target_id, {
                        "defect_type": dt,
                        "defect_type_en": dt,
                        "confidence": 0,
                        "signal_features": sf,
                        "prediction": {},
                    })
                    acceptance_ctx += build_acceptance_result_block(res, dt)
        except Exception:
            acceptance_ctx = ""

    if acceptance_ctx:
        system_prompt += acceptance_ctx

    # C-Scan 上下文（CScan 面板"发送给AI评估"带入；关键词命中时注入结果块）
    cscan_context = req.get("cscan_context")
    cscan_keywords = ['C扫', 'cscan', 'C扫描', 'C-Scan', 'C图', 'C 扫', 'C扫图']
    if any(k in question for k in cscan_keywords):
        if cscan_context:
            system_prompt += build_cscan_block(cscan_context)
            acc = cscan_context.get("acceptance")
            if acc and acc.get("passed") is not None and "error" not in acc:
                try:
                    system_prompt += build_acceptance_result_block(
                        acc, cscan_context.get("authoritative_defect_type") or "")
                except Exception:
                    pass
        else:
            system_prompt += ("\n\n用户询问 C-Scan 相关内容，但当前没有 C-Scan 检测上下文。"
                              "可引导用户在『数据标注』模块上传 C 扫图完成标注入库；"
                              "图像自动识别与送AI评估能力后续开放，暂以知识性解答为主。")

    # 争议项查询（对话式）
    dispute_keywords = ['争议', '争议项', '待仲裁', 'DSP']
    asks_dispute = any(k in question for k in dispute_keywords)
    dispute_ctx = ""
    if asks_dispute:
        try:
            import json as _json
            disputes = []
            if os.path.isdir(DISPUTES_DIR):
                for dname in sorted(os.listdir(DISPUTES_DIR), reverse=True):
                    meta_path = os.path.join(DISPUTES_DIR, dname, "metadata.json")
                    if os.path.exists(meta_path):
                        with open(meta_path, "r", encoding="utf-8") as f:
                            disputes.append(_json.load(f))
            if disputes:
                dispute_ctx = build_dispute_block(disputes)
            else:
                dispute_ctx = "\n\n## 争议项\n当前没有争议项记录。"
        except Exception:
            dispute_ctx = "\n\n## 争议项\n查询争议项时出错。"

    if dispute_ctx:
        system_prompt += dispute_ctx

    # 委托单 / 报告相关对话规则
    dispatch_keywords = ['报告', '委托单', '开具', '开报告', '检测报告']
    asks_dispatch = any(k in question for k in dispatch_keywords)
    if asks_dispatch and has_file:
        dispatch_data_ctx = ""
        if current_dispatch_data:
            dispatch_data_ctx = "\n\n## 已解析的委托单数据\n以下字段已从用户上传的委托单中解析出来：\n"
            for k, v in current_dispatch_data.items():
                if v:
                    dispatch_data_ctx += f"- {k}: {v}\n"

        system_prompt += build_dispatch_block(dispatch_data_ctx)

    # 调用 AI 流式返回
    async def text_generator():
        if ai_mode == 'local':
            if not has_file:
                yield "⚠️ **本地模型模式**仅支持对已上传的 .nde 文件进行预测分析。\n\n请先上传一个 .nde 文件，或者切换至 **DeepSeek 云端** 模式进行对话。"
                yield "\n__DONE__"
                return
            if not prediction or "error" in prediction:
                yield "⚠️ **本地模型模式**：没有可用的模型，请先在「模型训练」中训练一个模型。\n\n切换至 **DeepSeek 云端** 模式可获得详细分析。"
                yield "\n__DONE__"
                return

            # 本地模型模式：直接输出模型预测结果
            content = build_local_model_content(prediction)
            yield content
            yield "\n__DONE__"
            return

        messages = history if history and len(history) > 0 else [{"role": "user", "content": question}]
        try:
            async for text in chat_stream(
                messages=messages,
                system_prompt=system_prompt,
            ):
                if text:
                    yield text
            yield "\n__DONE__"
        except Exception as e:
            yield f"\n\n⚠️ 处理出错: {str(e)}"
            yield "\n__DONE__"

    return StreamingResponse(text_generator(), media_type="text/plain")

# 生成报告
@app.post("/chat/report")
def chat_report(req: dict):
    """生成并下载检测报告（含委托单数据）"""
    global current_dispatch_data
    try:
        dispatch = req.get("dispatch_data") or current_dispatch_data or {}
        report_path, report_id = generate_inspection_report(
            filename=req.get("filename", "unknown.nde"),
            meta=req.get("meta", {}),
            signal_analysis=req.get("signal_analysis", ""),
            defect_result=req.get("defect_result", ""),
            confidence=req.get("confidence", 0),
            model_name=req.get("model_name", ""),
            dispatch_data=dispatch,
        )
        return {
            "success": True,
            "report_id": report_id,
            "download_url": f"/chat/report/download/{report_id}",
        }
    except Exception as e:
        return {"success": False, "error": str(e)}

# 下载报告
@app.get("/chat/report/download/{report_id}")
def chat_report_download(report_id: str):
    """下载检测报告"""
    import glob as gglob
    report_dir = os.path.join(os.path.dirname(__file__), "reports")
    pattern = os.path.join(report_dir, f"{report_id}.docx")
    matches = gglob.glob(pattern)
    if not matches:
        # 容错：旧版文件无 -01 后缀
        if report_id.endswith('-01'):
            base = report_id[:-3]
            pattern = os.path.join(report_dir, f"{base}.docx")
            matches = gglob.glob(pattern)
    if not matches:
        return {"error": "报告文件不存在"}
    return FileResponse(
        path=matches[0],
        filename=f"检测报告_{report_id}.docx",
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )

# 解析nde
@app.get("/chat/current_file")
def chat_current_file():
    """返回当前上传的文件信息"""
    global current_file, current_filename
    if current_file and os.path.exists(current_file):
        # 读取部分元数据
        meta = load_nde_meta(current_file)
        # 从文件名解析基本参数
        parts = []
        if current_filename:
            parts = current_filename.replace(".nde", "").split("_")
        return {
            "file_path": current_file,
            "filename": current_filename,
            "meta": {
                "fiber": parts[0] if len(parts) > 0 else "-",
                "matrix": parts[1] if len(parts) > 1 else "-",
                "structure": parts[2] if len(parts) > 2 else "-",
                "method": parts[3] if len(parts) > 3 else "-",
                "defectType": parts[4] if len(parts) > 4 else "-",
            },
            "nde_meta": meta,
        }
    return {"file_path": None, "filename": None, "meta": None}


# endregion


# ══════════════════════════════════════════════════
# 7.验收判定 API
# ══════════════════════════════════════════════════
# region 验收判定

_checker = None

def get_checker():
    global _checker
    if _checker is None:
        _checker = AcceptanceChecker()
    return _checker

# 列出验收文件
@app.get("/acceptance/standards")
def acceptance_standards():
    """列出所有可用的验收标准"""
    try:
        checker = get_checker()
        return {"standards": checker.get_index()}
    except Exception as e:
        return {"error": str(e)}

# 执行缺陷判定
@app.post("/acceptance/check")
def acceptance_check(req: dict):
    """验收判定"""
    global current_file
    standard_id = req.get("standard_id", "")
    defect_type = req.get("defect_type", "")
    defect_type_en = req.get("defect_type_en", "")

    if not standard_id:
        return {"error": "缺少 standard_id"}

    try:
        # 构建信号特征
        signal_features = {}
        if current_file and os.path.exists(current_file):
            try:
                signal = analyze_signal(current_file)
                if signal:
                    signal_features = {k: v for k, v in signal.items() if isinstance(v, (int, float))}
                    signal_features["detected_frames"] = 64
            except Exception:
                pass

        # 如果请求中有额外的特征数据，合并进来
        req_features = req.get("signal_features", {})
        if req_features:
            signal_features.update(req_features)

        detection_result = {
            "defect_type": defect_type,
            "defect_type_en": defect_type_en,
            "confidence": req.get("confidence", 0),
            "signal_features": signal_features,
            "prediction": req.get("prediction", {}),
            "grade": req.get("grade") or None,   # CScan 重判时可带质量控制等级
        }

        checker = get_checker()
        result = checker.check(standard_id, detection_result)
        return result

    except Exception as e:
        return {"error": str(e)}

# 根据nde自动选择验收文件
@app.post("/acceptance/suggest_standard")
def acceptance_suggest_standard(req: dict):
    """根据材料信息自动推荐验收标准"""
    try:
        checker = get_checker()
        meta = req.get("meta", {})
        std_id = checker.suggest_standard(meta)
        return {"standard_id": std_id}
    except Exception as e:
        return {"error": str(e)}

# endregion


# ══════════════════════════════════════════════════
# 8.缺陷争议处理 API
# ══════════════════════════════════════════════════
# region 缺陷争议处理

DISPUTES_DIR = os.path.join(os.path.dirname(__file__), "disputes")
os.makedirs(DISPUTES_DIR, exist_ok=True)

# 提交争议
@app.post("/dispute/submit")
async def dispute_submit(
    file: UploadFile = File(None),
    description: str = Form(""),
    original_prediction: str = Form(""),
    user_claim: str = Form(""),
    original_file: str = Form(""),
):
    """登记争议项，可选上传证据 ZIP"""
    # 生成争议id
    import uuid
    dispute_id = f"DSP-{datetime.now().strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}"
    dispute_dir = os.path.join(DISPUTES_DIR, dispute_id)
    os.makedirs(dispute_dir, exist_ok=True)

    # 目录
    evidence_path = None
    if file and file.filename:
        ext = os.path.splitext(file.filename)[1].lower()
        if ext == ".zip":
            evidence_path = os.path.join(dispute_dir, f"evidence{ext}")
            with open(evidence_path, "wb") as f:
                f.write(await file.read())

    # 复制当前 .nde 文件到争议目录
    nde_copy_path = None
    nde_filename = original_file
    if current_file and os.path.exists(current_file):
        nde_filename = original_file or os.path.basename(current_file)
        nde_copy_path = os.path.join(dispute_dir, nde_filename)
        shutil.copy2(current_file, nde_copy_path)

    metadata = {
        "dispute_id": dispute_id,
        "timestamp": datetime.now().isoformat(),
        "original_file": nde_filename,
        "original_prediction": original_prediction,
        "user_claim": user_claim,
        "user_description": description,
        "evidence_file": evidence_path,
        "nde_file": nde_copy_path,
        "status": "待仲裁",
    }
    with open(os.path.join(dispute_dir, "metadata.json"), "w", encoding="utf-8") as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)

    return {"success": True, "dispute_id": dispute_id, "status": "待仲裁"}

# 列出所有争议
@app.get("/dispute/list")
def dispute_list():
    """列出所有争议项"""
    disputes = []
    if not os.path.isdir(DISPUTES_DIR):
        return {"disputes": []}
    for dname in sorted(os.listdir(DISPUTES_DIR), reverse=True):
        meta_path = os.path.join(DISPUTES_DIR, dname, "metadata.json")
        if os.path.exists(meta_path):
            with open(meta_path, "r", encoding="utf-8") as f:
                disputes.append(json.load(f))
    return {"disputes": disputes}

# 解析委托单
@app.post("/dispatch/upload")
async def dispatch_upload(file: UploadFile = File(...)):
    """上传已填写的委托单（.doc 或 .docx）文件，解析字段"""
    global current_dispatch_data
    suffix = os.path.splitext(file.filename)[1].lower()
    if suffix not in ('.doc', '.docx'):
        return {"success": False, "error": "仅支持 .doc 或 .docx 格式的委托单文件"}

    import tempfile
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    tmp.write(await file.read())
    tmp.close()

    try:
        data = parse_dispatch_doc(tmp.name)
        current_dispatch_data = data
        os.unlink(tmp.name)
        return {"success": True, "fields": data, "message": "委托单解析成功"}
    except Exception as e:
        os.unlink(tmp.name)
        return {"success": False, "error": f"委托单解析失败: {str(e)}"}

# endregion




# ══════════════════════════════════════════════════
# CScan YOLO 训练 / 验证评估 API（仿 AScan 训练/测试）
# ══════════════════════════════════════════════════
# region CScan Train / Eval

def _count_lines(path):
    if not os.path.isfile(path):
        return 0
    n = 0
    with open(path, encoding="utf-8") as f:
        for _ in f:
            n += 1
    return n


@app.get("/cscan/train/preview")
def cscan_train_preview():
    """CScan YOLO 训练预览：tile 规模/类别/预训练/已收编模型/ultralytics 可用。"""
    try:
        return {
            "available": ultralytics_available(),
            "classes": _cscan_class_list(),
            "n_train": _count_lines(os.path.join(CSCAN_DATASET_DIR, "train.txt")),
            "n_val": _count_lines(os.path.join(CSCAN_DATASET_DIR, "val.txt")),
            "n_images": len([f for f in os.listdir(CSCAN_IMAGES_DIR) if f.endswith(".png")])
                         if os.path.isdir(CSCAN_IMAGES_DIR) else 0,
            "pretrained": [p for p in CSCAN_PRETRAINED
                           if os.path.isfile(os.path.join(CSCAN_DATASET_DIR, p))],
            "models": list_cscan_model_meta(),
        }
    except Exception as e:
        return {"error": str(e)}


@app.post("/cscan/train/start")
def cscan_train_start(req: dict):
    """启动 CScan YOLO 训练（epochs/imgsz/batch/patience/seed/device/base）。"""
    try:
        job_id = start_cscan_train(req or {})
        return {"job_id": job_id, "status": "pending"}
    except Exception as e:
        return {"error": str(e)}


@app.get("/cscan/train/status/{job_id}")
def cscan_train_status(job_id: str):
    return get_cscan_train_status(job_id)


@app.get("/cscan/train/result/{job_id}")
def cscan_train_result(job_id: str):
    res = get_cscan_train_result(job_id)
    if res is None:
        return {"error": "result not available yet"}
    return res


@app.get("/cscan/train/models")
def cscan_train_models():
    return {"models": list_cscan_model_meta()}


@app.delete("/cscan/train/models/{model_name}")
def cscan_train_delete_model(model_name: str):
    """删除 backend/cscan_models 下模型（.pt + .json）。"""
    name = os.path.basename(model_name)
    stem = os.path.splitext(name)[0]
    removed = []
    for ext in (".pt", ".json"):
        p = os.path.join(CSCAN_MODELS_DIR_T, stem + ext)
        if os.path.isfile(p):
            os.remove(p)
            removed.append(ext)
    return {"success": True, "removed": removed}


@app.get("/cscan/train/file")
def cscan_train_file(run: str, name: str):
    """服务 runs/<run>/ 下的训练/评估产物图与 csv（防穿越）。"""
    if os.path.basename(run) != run or os.path.basename(name) != name:
        return {"error": "invalid name"}
    base = os.path.realpath(os.path.join(RUNS_DIR, run))
    if not base.startswith(os.path.realpath(RUNS_DIR) + os.sep) or not os.path.isdir(base):
        return {"error": "run 不存在"}
    p = os.path.join(base, name)
    if not os.path.isfile(p):
        return {"error": "file 不存在"}
    return FileResponse(p)


@app.post("/cscan/test/start")
def cscan_test_start(req: dict):
    """对选定 CScan 模型在验证集上跑 ultralytics val。"""
    try:
        job_id = start_cscan_eval(req or {})
        return {"job_id": job_id, "status": "pending"}
    except Exception as e:
        return {"error": str(e)}


@app.get("/cscan/test/status/{job_id}")
def cscan_test_status(job_id: str):
    return get_cscan_eval_status(job_id)


@app.get("/cscan/test/result/{job_id}")
def cscan_test_result(job_id: str):
    res = get_cscan_eval_result(job_id)
    if res is None:
        return {"error": "result not available yet"}
    return res

# endregion


# ══════════════════════════════════════════════════
# CScan 元数据智能解析（一段文字 → 自动提取关键词填字段）
# ══════════════════════════════════════════════════
# region CScan Meta Parse

_CSCAN_ZH = {
    "defectType": {"分层": "Dl", "脱粘": "Db", "孔隙": "Po", "气孔": "Vo",
                   "夹杂": "In", "富树脂": "Rs", "纤维相关": "Fb", "胶膜孔隙": "Ap",
                   "耦合不良": "Cp", "无缺陷": "OK", "好区": "OK"},
    "fiber": {"碳纤维": "CF", "碳纤": "CF", "玻璃纤维": "GF", "玻纤": "GF",
              "芳纶": "AF", "硼纤维": "BF"},
    "matrix": {"环氧": "EP", "双马来酰亚胺": "BMI", "双马": "BMI",
               "聚酰亚胺": "PI", "热塑性": "TP", "热塑": "TP", "碳化硅": "SiC"},
    "structure": {"板板胶接": "BondPP", "板芯胶接": "BondSC", "变厚度": "Taper", "变厚": "Taper",
                  "平板": "Plate", "蜂窝": "BondSC", "板-板": "BondPP", "板-芯": "BondSC",
                  "板板": "BondPP", "板芯": "BondSC"},
    "method": {"喷水穿透": "WPUT", "空耦穿透": "AUT", "水穿透": "WPUT", "穿透": "WPUT",
               "相控阵": "PAUT", "空耦": "AUT", "水浸": "WRUT", "水膜": "WRUT",
               "水耦合": "WRUT", "反射": "WRUT"},
}


def _cscan_vocab():
    """从 raw 已有边车统计各字段出现过值，用于任意文本的令牌匹配。"""
    keys = ("fiber", "matrix", "structure", "method", "code", "fiberGrade", "matrixGrade")
    vocab = {k: set() for k in keys}
    if os.path.isdir(CSCAN_RAW_DIR):
        for fn in os.listdir(CSCAN_RAW_DIR):
            if os.path.splitext(fn)[1].lower() not in CSCAN_IMAGE_EXTS:
                continue
            m = _read_cscan_sidecar(os.path.splitext(fn)[0], CSCAN_RAW_DIR)
            for k in keys:
                v = m.get(k)
                if v and v != "NaN":
                    vocab[k].add(str(v))
    return vocab


def _pick_zh(text: str, table: dict):
    """按别名长度降序在文本里找中文关键词 → 规范码。"""
    for alias, code in sorted(table.items(), key=lambda kv: -len(kv[0])):
        if alias in text:
            return code
    return ""


@app.post("/cscan/meta/parse")
def cscan_meta_parse(req: dict):
    """把一段文字（文件名/描述/关键词混排，格式不定）解析成 9 段元数据 + 时间戳 + 描述。
    优先整段匹配规范文件名(9 段)，否则用中文别名 + raw 已有值词典做令牌扫描。"""
    try:
        text = str(req.get("text", "")).strip()
        if not text:
            return {"error": "text 不能为空"}
        out = {"fiber": "", "matrix": "", "structure": "", "method": "",
               "defectType": "", "code": "", "fiberGrade": "", "matrixGrade": "",
               "timestamp": "", "probe_type": "", "description": text}

        # ① 规范文件名（9 段下划线）整段匹配
        m = _CSCAN_PATTERN.search(text)
        if m:
            g = m.groups()  # fiber,matrix,structure,method,defect,code,ts,extra
            for key, val in zip(("fiber", "matrix", "structure", "method",
                                 "defectType", "code", "timestamp"), g[:7]):
                if val and val != "NaN":
                    out[key] = val
            extra = (g[7] or "")
            parts = extra.split("_")
            if len(parts) >= 2:
                if parts[-2] and parts[-2] != "NaN": out["fiberGrade"] = parts[-2]
                if parts[-1] and parts[-1] != "NaN": out["matrixGrade"] = parts[-1]
            elif parts and parts[0] and parts[0] != "NaN":
                out["fiberGrade"] = parts[0]

        # ② 中文别名扫描（补齐上面没填的）
        for key, table in _CSCAN_ZH.items():
            if not out.get(key):
                out[key] = _pick_zh(text, table)

        # ③ raw 已有值词典扫描（型号/牌号/材料等已知值；避免误匹配太短令牌）
        vocab = _cscan_vocab()
        for key, values in vocab.items():
            if out.get(key):
                continue
            for val in sorted(values, key=len, reverse=True):
                if len(val) >= 2 and val in text:
                    out[key] = val
                    break

        # ④ 时间戳兜底
        if not out.get("timestamp"):
            ts = re.search(r"\d{14}", text)
            if ts:
                out["timestamp"] = ts.group()

        return {"meta": out}
    except Exception as e:
        return {"error": str(e)}

# endregion
