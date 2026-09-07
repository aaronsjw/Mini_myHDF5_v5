"""
CScan 图像 YOLO 缺陷检测推理模块（backend 专用，无 FastAPI 依赖）

- 懒加载 ultralytics（同 trainer.py 的 try/except 模式：无 ultralytics 环境 import 不炸）
- 对整张 C 扫图自动切块推理：几何与训练期 slice_remap 一致
  640 窗 / 512 步 / 末块右|下对齐；图宽高均 <=640 时整图直接预测
- 跨块全局 NMS 去重叠重复框；返回的 xyxy 均为【全图像素坐标】（勿除以 640）
- 给定 mm_per_px（整幅图的比例尺，切块共享）后产出物理尺寸：
  w_mm/h_mm / z_mm=(w+h)/2（对应标准 Z=(X+Y)/2）/ area_mm2 / area_pct
- build_cscan_features 把检测聚合为验收引擎需要的 cscan_* 标量键
"""

import os
import shutil
import math
from datetime import datetime

# ── 懒加载 ultralytics（同 trainer.py:22-32 模式）──────────────
try:
    from ultralytics import YOLO
    ULTRALYTICS_AVAILABLE = True
except ImportError:
    ULTRALYTICS_AVAILABLE = False
    YOLO = None

# 模块/权重路径
_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
_REPO_DIR = os.path.normpath(os.path.join(_BACKEND_DIR, ".."))
CSCAN_MODELS_DIR = os.path.join(_BACKEND_DIR, "cscan_models")
DEFAULT_SRC_MODEL = os.path.join(
    _REPO_DIR, "dataset", "cscan_dataset", "runs", "cscan_v1", "weights", "best.pt"
)

# 3 类，索引与训练 names 一致（见 dataset/cscan_dataset/dataset.yaml / codes.json）
CSCAN_CLASSES = {0: ("Dl", "分层"), 1: ("Db", "脱粘"), 2: ("Po", "孔隙")}
ABBR_TO_ID = {abbr: cid for cid, (abbr, _zh) in CSCAN_CLASSES.items()}

# 缺陷缩写 → 中文（验收/AI 上下文用）
V5_ABBR_TO_ZH = {
    "Cp": "耦合不良", "Db": "脱粘", "Dl": "分层", "Po": "孔隙",
    "Vo": "气孔", "In": "夹杂", "Fb": "纤维相关", "Rs": "富树脂",
    "OK": "无缺陷", "Uc": "不可分类",
}

TILE = 640          # 切分窗口（与 slice_remap.py 一致）
STRIDE = 512        # 步长（重叠 = TILE - STRIDE）
NMS_IOU = 0.5       # 跨块全局 NMS 的 IoU 阈值

_MODEL_CACHE = {}   # model_path -> YOLO 实例


def ultralytics_available() -> bool:
    return ULTRALYTICS_AVAILABLE


def _ensure_default_model() -> str:
    """首启：把训练产物 best.pt 拷进 backend/cscan_models（已 gitignore，不入库）。"""
    os.makedirs(CSCAN_MODELS_DIR, exist_ok=True)
    for fn in os.listdir(CSCAN_MODELS_DIR):
        if fn.lower().endswith(".pt"):
            return os.path.join(CSCAN_MODELS_DIR, fn)
    if not os.path.isfile(DEFAULT_SRC_MODEL):
        return ""
    dst = os.path.join(CSCAN_MODELS_DIR, "cscan_v1_best.pt")
    shutil.copy2(DEFAULT_SRC_MODEL, dst)
    return dst


def list_cscan_models() -> list:
    """backend/cscan_models 下的模型清单，按修改时间倒序。"""
    _ensure_default_model()
    models = []
    if os.path.isdir(CSCAN_MODELS_DIR):
        for fn in os.listdir(CSCAN_MODELS_DIR):
            if not fn.lower().endswith(".pt"):
                continue
            p = os.path.join(CSCAN_MODELS_DIR, fn)
            st = os.stat(p)
            models.append({
                "name": fn,
                "path": p,
                "size_bytes": st.st_size,
                "mtime_iso": datetime.fromtimestamp(st.st_mtime).isoformat(timespec="seconds"),
            })
    return sorted(models, key=lambda m: m["mtime_iso"], reverse=True)


def _get_model(model_path: str):
    """模型实例缓存。"""
    if not ULTRALYTICS_AVAILABLE:
        raise RuntimeError("ultralytics 未安装")
    if model_path not in _MODEL_CACHE:
        _MODEL_CACHE[model_path] = YOLO(model_path)
    return _MODEL_CACHE[model_path]


# ════════════ 几何 / NMS ════════════

def _tile_starts(length: int) -> list:
    """滑动窗口起点列表：0, STRIDE, …，末块对齐右/下边（同 slice_remap.py）。"""
    if length <= TILE:
        return [0]
    starts = []
    x = 0
    while x + TILE < length:
        starts.append(x)
        x += STRIDE
    last = length - TILE
    if starts[-1] != last:
        starts.append(last)
    return starts


def _nms(boxes: list, iou_thr: float = NMS_IOU) -> list:
    """boxes: [(x1,y1,x2,y2,score), …]；返回按 score 降序保留的索引列表。"""
    if not boxes:
        return []
    order = sorted(range(len(boxes)), key=lambda i: boxes[i][4], reverse=True)
    kept = []
    while order:
        i = order[0]
        kept.append(i)
        xi1, yi1, xi2, yi2, _ = boxes[i]
        area_i = (xi2 - xi1) * (yi2 - yi1)
        rest = []
        for j in order[1:]:
            xj1, yj1, xj2, yj2, _ = boxes[j]
            ix1, iy1 = max(xi1, xj1), max(yi1, yj1)
            ix2, iy2 = min(xi2, xj2), min(yi2, yj2)
            inter = max(0, ix2 - ix1) * max(0, iy2 - iy1)
            union = area_i + (xj2 - xj1) * (yj2 - yj1) - inter
            if (inter / union if union > 0 else 0) <= iou_thr:
                rest.append(j)
        order = rest
    return kept


def _min_edge_gap_px(boxes: list):
    """两两框间最小边缘间距（AABB 最短距离，px）；<2 框返回 None。"""
    if len(boxes) < 2:
        return None
    best = None
    for i in range(len(boxes)):
        a = boxes[i]
        for j in range(i + 1, len(boxes)):
            b = boxes[j]
            gx = max(a[0] - b[2], b[0] - a[2], 0)
            gy = max(a[1] - b[3], b[1] - a[3], 0)
            gap = math.hypot(gx, gy)
            if best is None or gap < best:
                best = gap
    return best


# ════════════ 主推理 ════════════

def analyze_cscan(image_path: str, model_path: str = "", mm_per_px=None,
                  conf: float = 0.35, iou: float = 0.45, device: str = "cpu") -> dict:
    """
    对一张 C 扫图跑 YOLO 缺陷检测。

    返回:
    {
      "model": model_path,
      "image": {"width", "height", "physical_w_mm", "physical_h_mm"},
      "mm_per_px": float|None,
      "detections": [{index, class_id, class_name_en, class_name_zh, confidence,
                      xyxy, w_px, h_px, w_mm, h_mm, z_mm, area_mm2, area_pct}],
      "stats": {count, total_area_mm2, total_area_pct, max_z_mm, max_dim_mm,
                min_edge_gap_mm, per_class:[...]}
    }
    mm_per_px 为空时 mm/area/area_pct 相关字段均为 None。
    """
    if not ULTRALYTICS_AVAILABLE:
        raise RuntimeError("ultralytics 未安装")
    model_path = model_path or _ensure_default_model()
    if not model_path or not os.path.isfile(model_path):
        raise RuntimeError("未找到 CScan 模型权重")

    from PIL import Image
    import numpy as np
    model = _get_model(model_path)

    with Image.open(image_path) as im:
        W, H = im.size
        rgb = np.asarray(im.convert("RGB"))

    def predict_crop(crop):
        """预测一个 crop，返回 [(class_id, conf, x1,y1,x2,y2)]（crop 像素坐标）。"""
        result = model.predict(crop, imgsz=TILE, conf=conf, iou=iou,
                               device=device, verbose=False)[0]
        hits = []
        if result.boxes is not None:
            for box in result.boxes:
                cid = int(box.cls[0])
                if cid not in CSCAN_CLASSES:      # 容错：非 3 类模型也能跑，跳过无关类
                    continue
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                hits.append((cid, float(box.conf[0]), x1, y1, x2, y2))
        return hits

    tile_hits = []  # (class_id, conf, gx1, gy1, gx2, gy2) 全图像素坐标
    if W > TILE or H > TILE:
        for ox in _tile_starts(W):
            for oy in _tile_starts(H):
                tw, th = min(TILE, W - ox), min(TILE, H - oy)
                crop = rgb[oy:oy + th, ox:ox + tw]
                for (cid, c, x1, y1, x2, y2) in predict_crop(crop):
                    tile_hits.append((cid, c, x1 + ox, y1 + oy, x2 + ox, y2 + oy))
    else:
        tile_hits = predict_crop(rgb)

    hits = []
    if tile_hits:
        kept = _nms([(gx1, gy1, gx2, gy2, s)
                     for (_c, s, gx1, gy1, gx2, gy2) in tile_hits])
        hits = [tile_hits[i] for i in kept]
        hits.sort(key=lambda t: t[1], reverse=True)

    mm = float(mm_per_px) if mm_per_px not in (None, "", 0) else None
    phys_w_mm = W * mm if mm else None
    phys_h_mm = H * mm if mm else None
    image_area_mm2 = (phys_w_mm * phys_h_mm) if mm else None

    detections = []
    for idx, (cid, c, x1, y1, x2, y2) in enumerate(hits):
        en, zh = CSCAN_CLASSES[cid]
        wpx, hpx = x2 - x1, y2 - y1
        det = {
            "index": idx, "class_id": cid,
            "class_name_en": en, "class_name_zh": zh,
            "confidence": round(c, 4),
            "xyxy": [round(x1, 1), round(y1, 1), round(x2, 1), round(y2, 1)],
            "w_px": round(wpx, 1), "h_px": round(hpx, 1),
        }
        if mm:
            wmm, hmm = wpx * mm, hpx * mm
            zmm = (wmm + hmm) / 2
            area_mm2 = wmm * hmm
            det.update({
                "w_mm": round(wmm, 2), "h_mm": round(hmm, 2), "z_mm": round(zmm, 2),
                "area_mm2": round(area_mm2, 2),
                "area_pct": round(area_mm2 / image_area_mm2 * 100, 4) if image_area_mm2 else None,
            })
        else:
            det.update(w_mm=None, h_mm=None, z_mm=None, area_mm2=None, area_pct=None)
        detections.append(det)

    # ── 统计 ──
    per_class = {}
    for d in detections:
        pc = per_class.setdefault(d["class_id"], {
            "class_id": d["class_id"], "class_name_en": d["class_name_en"],
            "class_name_zh": d["class_name_zh"], "count": 0,
            "max_z_mm": None, "total_area_mm2": None, "total_area_pct": None,
        })
        pc["count"] += 1
        if mm:
            pc["max_z_mm"] = d["z_mm"] if pc["max_z_mm"] is None else max(pc["max_z_mm"], d["z_mm"])
            pc["total_area_mm2"] = (pc["total_area_mm2"] or 0) + d["area_mm2"]

    for pc in per_class.values():
        if mm and image_area_mm2 and pc["total_area_mm2"] is not None:
            pc["total_area_mm2"] = round(pc["total_area_mm2"], 2)
            pc["total_area_pct"] = round(pc["total_area_mm2"] / image_area_mm2 * 100, 4)

    stats = {
        "count": len(detections),
        "total_area_mm2": None, "total_area_pct": None,
        "max_z_mm": None, "max_dim_mm": None, "min_edge_gap_mm": None,
        "per_class": [per_class[k] for k in sorted(per_class)],
    }
    if mm and detections:
        total = sum(d["area_mm2"] for d in detections)
        gap_px = _min_edge_gap_px([d["xyxy"] for d in detections])
        stats["total_area_mm2"] = round(total, 2)
        stats["total_area_pct"] = round(total / image_area_mm2 * 100, 4) if image_area_mm2 else None
        stats["max_z_mm"] = round(max(d["z_mm"] for d in detections), 2)
        stats["max_dim_mm"] = round(max(max(d["w_mm"], d["h_mm"]) for d in detections), 2)
        stats["min_edge_gap_mm"] = round(gap_px * mm, 2) if gap_px is not None else None

    return {
        "model": os.path.basename(model_path),
        "image": {"width": W, "height": H,
                  "physical_w_mm": round(phys_w_mm, 2) if phys_w_mm else None,
                  "physical_h_mm": round(phys_h_mm, 2) if phys_h_mm else None},
        "mm_per_px": mm,
        "detections": detections,
        "stats": stats,
    }


def build_cscan_features(stats: dict, abbr: str = "") -> dict:
    """
    把 analyze_cscan 的 stats 聚合成验收引擎用的 cscan_* 标量键。

    规则：abbr（权威缺陷类别）有检出 → 取该类聚合；否则取整体最严
    （max_z / max_area_pct）。无 mm_per_px 时尺寸键为 None —— 验收据此走
    "仍需补充尺寸"分支，与纯 AScan 行为一致。
    """
    per = {p["class_id"]: p for p in stats.get("per_class", [])}
    pick = None
    if abbr and abbr in ABBR_TO_ID:
        p = per.get(ABBR_TO_ID[abbr])
        if p and p["count"]:
            pick = p

    def grab(key):
        if pick is not None and pick.get(key) is not None:
            return pick[key]
        return stats.get(key)

    return {
        "cscan_z_value": grab("max_z_mm"),
        "cscan_area_pct": grab("total_area_pct"),
        "cscan_max_dim_mm": stats.get("max_dim_mm"),
        "cscan_edge_gap_min_mm": stats.get("min_edge_gap_mm"),
        "cscan_count": stats.get("count", 0),
    }
