"""
CScan YOLO 训练 / 验证评估（web 后台任务）——仿 backend/trainer.py 基建，独立于 AScan RF/DL。

要点（与 ultralytics Windows 运行相关的关键坑）：
- 数据只有 176 tile：训练/评估一律 workers=0，避开 Windows spawn 在 uvicorn 里 re-import 主模块崩溃。
- 不 os.chdir：全部路径传绝对（dataset.yaml 的 path 已绝对、train.txt 行为 ./images/...，与 cwd 无关）。
- 训练进度 = 轮询 <run>/results.csv 行数（进度实时给前端画曲线）。
- 训练完把 best.pt 拷进 backend/cscan_models/<name>.pt + 写 .json meta，即被 /cscan/models 与 analyze 收编。
"""

import os
import re
import csv
import json
import glob
import random
import shutil
import threading
import time
import traceback
import uuid
from datetime import datetime

# 懒加载 ultralytics（同 cscan_yolo 模式）
try:
    from ultralytics import YOLO
    ULTRALYTICS_AVAILABLE = True
except ImportError:
    ULTRALYTICS_AVAILABLE = False
    YOLO = None

_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
_REPO_DIR = os.path.normpath(os.path.join(_BACKEND_DIR, ".."))

DS_DIR = os.path.join(_REPO_DIR, "dataset", "cscan_dataset")
RUNS_DIR = os.path.join(DS_DIR, "runs")
DATA_YAML = os.path.join(DS_DIR, "dataset.yaml")
IMAGES_DIR = os.path.join(DS_DIR, "images")
LABELS_DIR = os.path.join(DS_DIR, "labels")
META_DIR = os.path.join(DS_DIR, "meta")
MODELS_DIR = os.path.join(_BACKEND_DIR, "cscan_models")

PRETRAINED = ["yolov8n.pt", "yolo11n.pt"]
CLASS_ZH = {"Dl": "分层", "Db": "脱粘", "Po": "孔隙"}

_TS = lambda: datetime.now().strftime("%Y%m%d_%H%M%S")

# 任务表
_ytasks = {}   # cscan train jobs
_etasks = {}   # cscan eval jobs

_RESULTS_HEADER = [
    "epoch", "time", "box_loss", "cls_loss", "dfl_loss",
    "precision", "recall", "mAP50", "mAP50_95",
    "val_box_loss", "val_cls_loss", "val_dfl_loss",
]


def ultralytics_available() -> bool:
    return ULTRALYTICS_AVAILABLE


def ensure_dirs():
    for d in (DS_DIR, RUNS_DIR, MODELS_DIR):
        os.makedirs(d, exist_ok=True)


# ════════════ 训练集划分（进程内复刻 tools/split_dataset.py 核心）════════════

def _resplit(seed: int = 42, val_ratio: float = 0.2):
    """按 source_raw 原图分组随机 80/20 写 train.txt/val.txt（防泄漏）。
    行前缀 ./images/ 保证 ultralytics 相对 path 解析。"""
    src_info = {}
    for mf in glob.glob(os.path.join(META_DIR, "*.json")):
        try:
            m = json.load(open(mf, encoding="utf-8"))
        except Exception:
            continue
        src = m.get("source_raw")
        if not src:
            continue
        stem = os.path.splitext(os.path.basename(mf))[0]
        cls = set()
        lf = os.path.join(LABELS_DIR, stem + ".txt")
        if os.path.isfile(lf):
            for ln in open(lf, encoding="utf-8"):
                ln = ln.strip()
                if ln:
                    cls.add(int(ln.split()[0]))
        info = src_info.setdefault(src, {"tiles": [], "classes": set()})
        info["tiles"].append(stem + ".png")
        info["classes"].update(cls)

    srcs = sorted(src_info)
    rng = random.Random(seed)
    order = list(srcs)
    rng.shuffle(order)
    n_val = max(1, round(len(order) * val_ratio))
    val_srcs = set(order[:n_val])
    train_tiles, val_tiles = [], []
    for s in srcs:
        target = val_tiles if s in val_srcs else train_tiles
        target += [f"./images/{t}" for t in src_info[s]["tiles"]]

    with open(os.path.join(DS_DIR, "train.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(sorted(train_tiles)) + "\n")
    with open(os.path.join(DS_DIR, "val.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(sorted(val_tiles)) + "\n")
    return {"train": len(train_tiles), "val": len(val_tiles)}


# ════════════ results.csv 解析 ════════════

def _read_csv_rows(results_csv: str) -> list:
    """results.csv → 逐 epoch dict（含表头 15 列中我们关心的前 12）。"""
    if not os.path.isfile(results_csv):
        return []
    rows = []
    with open(results_csv, newline="", encoding="utf-8") as f:
        rd = csv.reader(f)
        next(rd, None)  # 表头
        for line in rd:
            if len(line) < 12:
                continue
            try:
                rows.append({
                    "epoch": int(float(line[0])),
                    "time": float(line[1]) if line[1] else None,
                    "box_loss": float(line[2]),
                    "cls_loss": float(line[3]),
                    "dfl_loss": float(line[4]),
                    "precision": float(line[5]),
                    "recall": float(line[6]),
                    "mAP50": float(line[7]),
                    "mAP50_95": float(line[8]),
                    "val_box_loss": float(line[9]),
                    "val_cls_loss": float(line[10]),
                    "val_dfl_loss": float(line[11]),
                })
            except Exception:
                continue
    return rows


def _plot_images(run_dir: str) -> list:
    if not os.path.isdir(run_dir):
        return []
    names = [f for f in os.listdir(run_dir)
             if f.lower().endswith((".png", ".jpg"))]
    return sorted(names)


# ════════════ 模型收编 / 列表 ════════════

def _write_model_meta(stem: str, meta: dict):
    with open(os.path.join(MODELS_DIR, stem + ".json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)


def list_cscan_model_meta() -> list:
    """backend/cscan_models 模型列表（.json meta，旧 .pt 无 json 给占位）。"""
    ensure_dirs()
    out = []
    for fn in sorted(os.listdir(MODELS_DIR)):
        stem = os.path.splitext(fn)[0]
        if fn.lower().endswith(".pt"):
            mpath = os.path.join(MODELS_DIR, fn)
            jpath = os.path.join(MODELS_DIR, stem + ".json")
            if os.path.isfile(jpath):
                try:
                    meta = json.load(open(jpath, encoding="utf-8"))
                except Exception:
                    meta = {}
            else:
                meta = {}
            meta.setdefault("model_name", stem)
            meta.setdefault("model_file", fn)
            meta.setdefault("model_type", "cscan_yolo")
            meta.setdefault("accuracy", None)
            meta.setdefault("saved_at", datetime.fromtimestamp(os.path.getmtime(mpath)).isoformat(timespec="seconds"))
            out.append(meta)
    return sorted(out, key=lambda m: m.get("saved_at", ""), reverse=True)


def _resolve_base(base: str) -> str:
    """把起始权重名解析为绝对路径：pretrained(yolov8n/yolo11n) 或 backend/cscan_models 现有模型。"""
    base = base or "yolov8n.pt"
    if base in PRETRAINED:
        p = os.path.join(DS_DIR, base)
        if os.path.isfile(p):
            return p
    p = os.path.join(MODELS_DIR, base)
    if os.path.isfile(p):
        return p
    raise FileNotFoundError(f"起始权重不存在: {base}")


# ════════════ 训练 ════════════

def _run_cscan_train(job: dict, cfg: dict):
    try:
        ensure_dirs()
        job["status"] = "loading"
        job["progress"] = 0
        epochs = int(cfg.get("epochs", 30))
        imgsz = int(cfg.get("imgsz", 640))
        batch = int(cfg.get("batch", 4))
        patience = int(cfg.get("patience", 30))
        seed = int(cfg.get("seed", 42))
        device = str(cfg.get("device", "cpu"))
        base = str(cfg.get("base", "yolov8n.pt"))

        _resplit(seed)
        if not ULTRALYTICS_AVAILABLE:
            raise RuntimeError("ultralytics 未安装（用 cscan_env 跑后端）")
        base_abs = _resolve_base(base)

        ts = _TS()
        run_name = f"cscan_{ts}"
        run_dir = os.path.join(RUNS_DIR, run_name)

        worker_state = {"done": False, "error": None}

        def worker():
            try:
                model = YOLO(base_abs)
                model.train(
                    data=DATA_YAML, epochs=epochs, imgsz=imgsz, batch=batch,
                    patience=patience, seed=seed, device=device,
                    workers=0, cache=True, plots=True,
                    project=RUNS_DIR, name=run_name, exist_ok=False, verbose=False,
                )
                worker_state["done"] = True
            except Exception:
                worker_state["done"] = True
                worker_state["error"] = traceback.format_exc()

        th = threading.Thread(target=worker, daemon=True)
        job["status"] = "training"
        job["run_name"] = run_name
        th.start()
        rows = []
        while th.is_alive() or not worker_state["done"]:
            time.sleep(1)
            rows = _read_csv_rows(os.path.join(run_dir, "results.csv"))
            if rows:
                job["epoch"] = rows[-1]["epoch"]
                job["progress"] = int(min(100, round(job["epoch"] / max(1, epochs) * 100)))
                job["current"] = rows[-1]
            if worker_state["done"]:
                break
        th.join(timeout=3)
        if worker_state["error"]:
            raise RuntimeError(worker_state["error"])

        rows = _read_csv_rows(os.path.join(run_dir, "results.csv"))
        best = os.path.join(run_dir, "weights", "best.pt")
        if not os.path.isfile(best):
            raise FileNotFoundError(f"训练未产出 best.pt: {best}")
        acc = max((r["mAP50"] for r in rows if r.get("mAP50") is not None), default=0.0)
        # 有信息的模型名：yolo_<类别>_<mAP50>_<日期>_<时间>（同 AScan 的 deep_... 风格）
        cls_part = "_".join(sorted(CLASS_ZH))
        stem = f"yolo_{cls_part}_{acc:.3f}_{ts}"
        shutil.copy2(best, os.path.join(MODELS_DIR, stem + ".pt"))
        meta = {
            "model_name": stem,
            "model_file": stem + ".pt",
            "model_type": "cscan_yolo",
            "accuracy": round(acc, 4),
            "saved_at": datetime.now().isoformat(timespec="seconds"),
            "class_names": sorted(CLASS_ZH),
            "epochs": job["epoch"] if rows else 0,
            "run_name": run_name,
            "run_dir": run_dir,
            "results_path": os.path.join(run_dir, "results.csv"),
        }
        _write_model_meta(stem, meta)
        job["result"] = {
            **meta,
            "history": rows,
            "plot_images": _plot_images(run_dir),
        }
        job["status"] = "done"
        job["progress"] = 100
    except Exception:
        job["status"] = "error"
        job["error"] = traceback.format_exc()


# ════════════ 验证评估 ════════════

def _run_cscan_eval(job: dict, cfg: dict):
    try:
        ensure_dirs()
        job["status"] = "loading"
        job["progress"] = 0
        model_name = str(cfg.get("model_name", ""))
        imgsz = int(cfg.get("imgsz", 640))
        device = str(cfg.get("device", "cpu"))
        if not model_name:
            raise ValueError("model_name 不能为空")
        if not ULTRALYTICS_AVAILABLE:
            raise RuntimeError("ultralytics 未安装")
        mp = os.path.join(MODELS_DIR, model_name)
        if not os.path.isfile(mp):
            mp = _resolve_base(model_name)
        ts = _TS()
        run_name = f"eval_{ts}"
        model = YOLO(mp)
        m = model.val(
            data=DATA_YAML, split="val", imgsz=imgsz, device=device,
            workers=0, plots=True, project=RUNS_DIR, name=run_name,
            exist_ok=False, verbose=False,
        )
        run_dir = os.path.join(RUNS_DIR, run_name)   # val 用 project/name 固定落点

        def _num(x, default=0.0):
            try:
                return float(x)
            except Exception:
                return default

        overall = {
            "mAP50": _num(getattr(m.box, "map50", 0.0)),
            "mAP50_95": _num(getattr(m.box, "map", 0.0)),
            "P": _num(getattr(m.box, "mp", 0.0)),
            "R": _num(getattr(m.box, "mr", 0.0)),
        }
        # 逐类 mAP50-95（m.box.maps 与 ap_class_index 对齐）
        per_class = []
        try:
            names = list(model.names.values())
            ap_idx = [int(i) for i in m.box.ap_class_index]
            maps = [float(x) for x in m.box.maps]
            for i, name in enumerate(names):
                k = ap_idx.index(i) if i in ap_idx else None
                per_class.append({
                    "name": name,
                    "zh": CLASS_ZH.get(name, name),
                    "mAP50_95": round(maps[k], 4) if k is not None and k < len(maps) else None,
                })
        except Exception:
            per_class = []

        job["result"] = {
            "model_name": model_name,
            "run_name": run_name,
            "run_dir": run_dir,
            "overall": overall,
            "per_class": per_class,
            "class_names": list(model.names.values()),
            "plot_images": _plot_images(run_dir),   # 含 confusion_matrix(_normalized)/PR_curve/val_batch*_pred
        }
        job["status"] = "done"
        job["progress"] = 100
    except Exception:
        job["status"] = "error"
        job["error"] = traceback.format_exc()


# ════════════ 对外入口 ════════════

def start_cscan_train(cfg: dict) -> str:
    job_id = uuid.uuid4().hex[:12]
    _ytasks[job_id] = {"status": "pending", "progress": 0, "epoch": 0,
                       "current": None, "result": None, "error": None, "run_name": ""}
    threading.Thread(target=_run_cscan_train, args=(_ytasks[job_id], cfg), daemon=True).start()
    return job_id


def get_cscan_train_status(job_id: str) -> dict:
    return _ytasks.get(job_id, {"status": "not_found"})


def get_cscan_train_result(job_id: str):
    task = _ytasks.get(job_id)
    if task and task["status"] == "done":
        return task["result"]
    return None


def start_cscan_eval(cfg: dict) -> str:
    job_id = uuid.uuid4().hex[:12]
    _etasks[job_id] = {"status": "pending", "progress": 0, "result": None, "error": None, "run_name": ""}
    threading.Thread(target=_run_cscan_eval, args=(_etasks[job_id], cfg), daemon=True).start()
    return job_id


def get_cscan_eval_status(job_id: str) -> dict:
    return _etasks.get(job_id, {"status": "not_found"})


def get_cscan_eval_result(job_id: str):
    task = _etasks.get(job_id)
    if task and task["status"] == "done":
        return task["result"]
    return None
