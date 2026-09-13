"""
CScan 原图入库流水线（backend 专用，无 ultralytics/FastAPI 依赖）

把一张"原始未处理 C 扫图 + 边车元数据 + 手工 YOLO 框"落成 raw/ 三件套，
并按与训练一致的几何切片更新 images/labels/meta：
  1. 规范化 9 段文件名 → raw/<stem>.<ext> + raw/<stem>.json + raw/<stem>.txt
  2. slice_raw_image：读 raw/<stem>.txt，640/512 切图、框重映射、负样本限量，
     幂等清旧 tile 后写 images/labels/meta（三件套），不动 train.txt/val.txt/dataset.yaml

⚠ 几何常量与函数 = backend/cscan_tools/slice_remap.py / backend/cscan_yolo.py 的拷贝，三者必须一致（改一处全改）。
"""

import os
import re
import json
import random
from datetime import datetime

from PIL import Image

# ════════════ 几何常量（与 slice_remap.py / cscan_yolo.py 保持一致）════════════
TILE = 640
STRIDE = 512            # 重叠 = TILE - STRIDE
KEEP_RATIO = 0.20       # 框裁剪后保留面积阈值（相对原框）
NEG_CAP_EMPTY_IMAGE = 12  # 无框图（纯背景）最多保留的背景 tile 数
SEED = 42

# 缺陷码 → 中文（新类默认中文名，仅用于 codes.json）
CODE_ZH = {
    "OK": "好区", "Dl": "分层", "Db": "脱粘", "Po": "孔隙", "Ap": "胶膜孔隙",
    "Vo": "气孔", "In": "夹杂", "Fb": "纤维相关", "Rs": "树脂相关",
    "Cp": "耦合不良", "Uc": "不可识别",
}

_TS_RE = re.compile(r"^\d{14}$")
_CLEAN_RE = re.compile(r"[/\\\s_]+")


# ════════════ 纯工具函数 ════════════

def tile_starts(length: int) -> list:
    """滑动窗口起点列表：0, STRIDE, …，末块对齐右/下边。"""
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


def remap_box(box, ox, oy, tw, th):
    """把一张图的 YOLO 框（全图像素坐标）裁剪到 tile 并归一化。
    box = (class_id, x1, y1, x2, y2)；保留面积 >= KEEP_RATIO。返回 YOLO 行或 None。"""
    cid, x1, y1, x2, y2 = box
    area = (x2 - x1) * (y2 - y1)
    cx1, cy1 = max(x1, ox), max(y1, oy)
    cx2, cy2 = min(x2, ox + tw), min(y2, oy + th)
    if cx2 <= cx1 or cy2 <= cy1:
        return None
    c_area = (cx2 - cx1) * (cy2 - cy1)
    if area <= 0 or c_area / area < KEEP_RATIO:
        return None
    w = (cx2 - cx1) / tw
    h = (cy2 - cy1) / th
    cx = (cx1 - ox + cx2 - ox) / 2 / tw
    cy = (cy1 - oy + cy2 - oy) / 2 / th
    return f"{cid} {cx:.6f} {cy:.6f} {w:.6f} {h:.6f}"


def parse_yolo(path: str) -> list:
    """读 raw YOLO txt -> [(class_id, cx, cy, w, h 归一化)]。空/缺 -> []。"""
    boxes = []
    if not os.path.isfile(path):
        return boxes
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            p = line.split()
            if len(p) != 5:
                continue
            boxes.append((int(p[0]), float(p[1]), float(p[2]), float(p[3]), float(p[4])))
    return boxes


def read_classes(path: str) -> list:
    """读类表，返回 [code,...]；行号 = class_id。"""
    classes = []
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            classes = [ln.strip() for ln in f if ln.strip()]
    return classes


def add_class(labels_path: str, codes_path: str, code: str, zh: str = "") -> int:
    """新增缺陷码：写入 raw/labels.txt（追加行）+ codes.json（追加项）。只追加不改旧 id。
    已存在 → 直接返回其 class_id。"""
    code = (code or "").strip()
    if not code:
        raise ValueError("缺陷码不能为空")
    classes = read_classes(labels_path)
    if code in classes:
        return classes.index(code)

    nid = len(classes)
    with open(labels_path, "a", encoding="utf-8") as f:
        f.write(code + "\n")

    codes = []
    if os.path.exists(codes_path):
        try:
            with open(codes_path, encoding="utf-8") as f:
                codes = json.load(f)
        except Exception:
            codes = []
    codes.append({"id": nid, "code": code, "zh": zh or CODE_ZH.get(code, code)})
    with open(codes_path, "w", encoding="utf-8") as f:
        json.dump(codes, f, ensure_ascii=False, indent=2)
    return nid


def _clean_field(value) -> str:
    """清洗字段用于文件名：去下划线/空白/斜杠，空则 NaN。"""
    if value is None:
        return "NaN"
    s = str(value).strip()
    s = _CLEAN_RE.sub("-", s)
    return s or "NaN"


def normalize_stem(meta: dict, fallback_mtime=None) -> str:
    """按 9 段规范化 raw 文件名 stem（去扩展名）。
    段序：{fiber}_{matrix}_{structure}_{method}_{defectType}_{code}_{ts}_{fiberGrade}_{matrixGrade}
    ts 缺省从 meta['timestamp'] 取，仍不合 14 位 → fallback_mtime(datetime) 或当前时间。"""
    ts = str(meta.get("timestamp") or "").strip()
    if not _TS_RE.match(ts):
        t = fallback_mtime or datetime.now()
        ts = t.strftime("%Y%m%d%H%M%S")
    return "_".join([
        _clean_field(meta.get("fiber")),
        _clean_field(meta.get("matrix")),
        _clean_field(meta.get("structure")),
        _clean_field(meta.get("method")),
        _clean_field(meta.get("defectType")),
        _clean_field(meta.get("code")),
        ts,
        _clean_field(meta.get("fiberGrade")),
        _clean_field(meta.get("matrixGrade")),
    ])


def find_raw_image(raw_dir: str, stem: str, exts=(".bmp", ".png", ".jpg", ".jpeg")):
    """在 raw/ 找 <stem>.<ext>，返回绝对路径；无则 None。"""
    for ext in exts:
        p = os.path.join(raw_dir, stem + ext)
        if os.path.isfile(p):
            return p
    return None


# ════════════ 单图切片（复刻 slice_remap.main 的循环体，参数化目录）════════════

def slice_raw_image(stem: str, meta: dict, raw_dir: str,
                    images_dir: str, labels_dir: str, meta_dir: str,
                    classes: list) -> dict:
    """
    把 raw/<stem>.<ext>(+同名 txt 框 + 传入 meta 边车) 切片写入 images/labels/meta。
    先删该 stem 的旧 tile 保证幂等。返回 {tiles, pos, neg}。不动 train/val/yaml。
    """
    img_path = find_raw_image(raw_dir, stem)
    if not img_path:
        raise FileNotFoundError(f"raw 下找不到 {stem} 的图片")

    # 幂等：清旧（整图同名 与 _tNNN 切片）
    for d in (images_dir, labels_dir, meta_dir):
        if not os.path.isdir(d):
            continue
        for fn in os.listdir(d):
            if fn.startswith(stem + ".") or fn.startswith(stem + "_"):
                os.remove(os.path.join(d, fn))

    boxes = parse_yolo(os.path.join(raw_dir, stem + ".txt"))  # 归一化 YOLO

    with Image.open(img_path) as im:
        W, H = im.size
        rgb = im.convert("RGB")

    # 归一化 → 全图像素（remap 在像素空间做）
    boxes_px = []
    for (cid, cx, cy, w, h) in boxes:
        x1, y1 = (cx - w / 2) * W, (cy - h / 2) * H
        x2, y2 = (cx + w / 2) * W, (cy + h / 2) * H
        boxes_px.append((cid, x1, y1, x2, y2))

    # 小图(宽高均<640)整图保留，否则 640/512 切分（末块对齐右/下）
    if W < TILE and H < TILE:
        tiles = [(0, 0, W, H, False)]
    else:
        tiles = [(ox, oy, min(TILE, W - ox), min(TILE, H - oy), True)
                 for ox in tile_starts(W) for oy in tile_starts(H)]

    pos_tiles, neg_tiles = [], []
    for i, (ox, oy, tw, th, sliced) in enumerate(tiles):
        yolo_lines = []
        for b in boxes_px:
            line = remap_box(b, ox, oy, tw, th)
            if line is not None:
                yolo_lines.append(line)
        (pos_tiles if yolo_lines else neg_tiles).append((i, ox, oy, tw, th, sliced, yolo_lines))

    rng = random.Random(SEED)
    if pos_tiles:
        keep = min(len(neg_tiles), len(pos_tiles))
    else:
        keep = min(len(neg_tiles), NEG_CAP_EMPTY_IMAGE)
    rng.shuffle(neg_tiles)
    chosen = pos_tiles + neg_tiles[:keep]

    pos = neg = 0
    for i, ox, oy, tw, th, sliced, yolo_lines in chosen:
        name = f"{stem}_t{i:03d}.png" if sliced else f"{stem}.png"
        crop = rgb.crop((ox, oy, ox + tw, oy + th))
        crop.save(os.path.join(images_dir, name))

        lbl = os.path.join(labels_dir, os.path.splitext(name)[0] + ".txt")
        with open(lbl, "w", encoding="utf-8") as f:
            if yolo_lines:
                f.write("\n".join(yolo_lines) + "\n")

        tile_meta = dict(meta)
        tile_meta["source_raw"] = stem
        tile_meta["tile"] = {"index": i, "offset_x": ox, "offset_y": oy,
                             "tile_w": tw, "tile_h": th, "sliced": sliced}
        with open(os.path.join(meta_dir, os.path.splitext(name)[0] + ".json"),
                  "w", encoding="utf-8") as f:
            json.dump(tile_meta, f, ensure_ascii=False, indent=2)

        if yolo_lines:
            pos += 1
        else:
            neg += 1

    return {"stem": stem, "tiles": pos + neg, "pos": pos, "neg": neg}
