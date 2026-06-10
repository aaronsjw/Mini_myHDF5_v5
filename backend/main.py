
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import FileResponse, StreamingResponse
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
    generate_inspection_report,
    predict_single_file,
)
from signal_analysis import analyze_signal, load_nde_meta, analyze_waveform_per_frame, analyze_waveform_keypoints
from deepseek_client import chat_stream


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

    return {"message": "uploaded", "file_path": current_file, "filename": current_filename}

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


@app.post("/chat/report")
def chat_report(req: dict):
    """生成并下载检测报告"""
    try:
        report_path, report_id = generate_inspection_report(
            filename=req.get("filename", "unknown.nde"),
            meta=req.get("meta", {}),
            signal_analysis=req.get("signal_analysis", ""),
            defect_result=req.get("defect_result", ""),
            confidence=req.get("confidence", 0),
            model_name=req.get("model_name", ""),
        )
        return {
            "success": True,
            "report_id": report_id,
            "download_url": f"/chat/report/download/{report_id}",
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.get("/chat/report/download/{report_id}")
def chat_report_download(report_id: str):
    """下载检测报告"""
    import glob as gglob
    report_dir = os.path.join(os.path.dirname(__file__), "reports")
    pattern = os.path.join(report_dir, f"{report_id}.docx")
    matches = gglob.glob(pattern)
    if not matches:
        return {"error": "报告文件不存在"}
    return FileResponse(
        path=matches[0],
        filename=f"检测报告_{report_id}.docx",
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )


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
]


def _get_n_frames_from_file(f: h5py.File) -> int:
    """从打开的 HDF5 文件中获取帧数"""
    for c in ["Public/Groups/0/Datasets/0-AScanAmplitude", "0-AScanAmplitude", "AScanAmplitude"]:
        if c in f:
            ds = f[c]
            if ds.ndim == 3:
                return ds.shape[0]
            return 64
    return 64


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
            if "Private/FrameLabels" not in f:
                n = _get_n_frames_from_file(f)
                ds = f.create_dataset("Private/FrameLabels", (n, 1), dtype=np.int32, fillvalue=-1)
            else:
                ds = f["Private/FrameLabels"]

            ds[frame_index, 0] = label_id
            return {"success": True, "frame_index": frame_index, "label_id": int(ds[frame_index, 0])}
    except Exception as e:
        return {"error": str(e)}


@app.get("/label_options")
def label_options():
    """返回标签选项列表"""
    return {"options": FRAME_LABEL_OPTIONS}


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
        # ── 有文件：读取信号 + 模型预测 ──
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

        # ── 提取元数据文本 ──
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

        # ── 信号特征文本 ──
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

        # ── 预测结果文本 ──
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

        # ── 构造 system prompt ──
        system_prompt = f"""你是复合材料智能检测与评估助手小史。你的任务是根据提供的 .nde 文件信号特征和模型预测结果，综合分析是否存在缺陷以及缺陷类型。

## 材料与检测参数
{chr(10).join(meta_lines) if meta_lines else "- 未获取到详细参数"}

## 信号特征
{chr(10).join(signal_lines) if signal_lines else "- 信号分析未完成"}

## 模型预测输出
{chr(10).join(pred_lines) if pred_lines else "- 无可用模型预测结果"}
"""

        if prediction and "error" not in prediction and prediction['confidence'] > 0.6:
            system_prompt += f"""
## 分析规则
1. 依据上述信号特征和模型输出来分析，给出详细结论
2. **不要直接说出"模型预测为X类"**，而是说"信号特征与X类缺陷模式高度吻合"
3. 必须从信号层面解释：回波特征、幅值变化、底波衰减、异常区域等
4. 分析要详细、专业，涵盖材料参数、信号特征、缺陷判断、置信度评估
5. 用中文回复，适当使用 Markdown 格式（标题、加粗、列表、引用等）
6. 如果置信度低于60%，要提示"需要进一步确认"
7. **重要：Dl=分层(Delamination)，Db=脱粘(Debonding)。不要在回复中把 Dl 和 Db 的中文名搞反！**
"""
        else:
            system_prompt += f"""
## 分析规则
1. 依据上述信号特征进行分析，给出初步结论
2. 坦诚告知模型预测置信度不足，建议进一步检测
3. 用中文回复，适当使用 Markdown 格式
"""

    else:
        # ── 无文件：通用助手指令 ──
        system_prompt = """你是复合材料智能检测与评估助手小史。你可以：
1. 介绍复合材料超声检测的相关知识
2. 解释常见的缺陷类型（分层、脱粘、气孔、夹杂等）
3. 回答关于 NDE 检测工艺的问题
4. 引导用户上传 .nde 文件进行具体分析

当用户询问缩写含义时，可参考以下信息：
- 缺陷类型：OK=好区, Dl=分层, Db=脱粘, Po=孔隙, Vo=气孔, In=夹杂, Fb=纤维相关, Rs=树脂相关, Cp=耦合不良, Uc=不可识别
- 纤维类型：CF=碳纤维, GF=玻璃纤维, BF=硼纤维, AF=芳纶纤维, C/SiC=碳/碳化硅
- 基体类型：EP=环氧, BMI=双马, PI=聚酰亚胺, TP=热塑, SiC=碳化硅
- 结构：Plate=平板, Taper=变厚度平板, RZone=R区, BondPP=板板胶接, BondSC=板芯胶接, Hybrid=混杂铺层
- 检测方法：WRUT=水耦合反射/水浸, WPUT=水穿透, DBUT=延迟块耦合, PAUT=相控阵, AUT=空耦, LUT=激光

请用中文回复，适当使用 Markdown 格式。如果用户询问具体文件分析，请提醒用户上传 .nde 文件。"""
    # ── 如果询问数据库信息，追加数据集描述 ──
    if dataset_info:
        defect_detail = "、".join([f"{k}({v}个)" for k, v in dataset_info["by_defect"].items()])
        dataset_block = f"""

## 数据集概况（当前数据库）
- 总文件数：{dataset_info['total_files']} 个 .nde 文件
- 缺陷类型：{", ".join(dataset_info['defect_types'])}
- 各类缺陷分布：{defect_detail}
- 纤维类型：{", ".join(dataset_info['fibers'])}
- 基体类型：{", ".join(dataset_info['matrixes'])}
- 结构类型：{", ".join(dataset_info['structures'])}
- 检测方法：{", ".join(dataset_info['methods'])}

请根据以上真实数据回答用户的问题。"""
        system_prompt += dataset_block

    # ── 调用 AI 流式返回 ──
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
            content = f"""## 本地模型分析结果

### 模型信息
- **模型名称**：{prediction['model_name']}
- **模型类型**：{prediction['model_type']}

### 预测结果
- **Top-1 预测**：**{prediction['prediction']}**
- **置信度**：{prediction['confidence']:.1%}
- **Top-3**：{', '.join(prediction['top3'])}

### 各类别概率详情

| 类别 | 概率 |
|------|------|
"""
            for cls, prob in sorted(prediction['probabilities'].items(), key=lambda x: x[1], reverse=True):
                bar_len = int(prob * 30)
                bar = '█' * bar_len + '░' * (30 - bar_len)
                content += f"| **{cls}** | {prob:.1%} {bar} |\n"

            content += """
> 当前使用本地模型进行评估，如需更详细的分析（信号特征、材料参数等），请切换至 **DeepSeek 云端** 模式。"""
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


def get_dataset_summary():
    """扫描 dataset/ 目录，返回数据集概要信息"""
    import re
    base = os.path.join(os.path.dirname(__file__), "..", "dataset")
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
