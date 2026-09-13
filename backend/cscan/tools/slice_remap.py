"""
CScan 整图标注 → 切分 + 框重映射 → images/labels/meta 三件套

输入:  dataset/cscan_dataset/raw/
        - 原始 C 扫图 (bmp/png/jpg/jpeg)
        - 同名 YOLO 标注 (无同名 txt = 无框/背景，如 OK 好区图)
        - 同名边车 JSON (UTF-8, 权威元数据)
        - labels.txt 类表 (行号=class_id)

输出:  dataset/cscan_dataset/{images,labels,meta}/
        - images/  切分 tile / 小图整图, 统一 .png
        - labels/  同名 YOLO txt (class_id cx cy w h, 归一化到 tile)
        - meta/    同名边车 JSON (继承父图 + source_raw + tile 溯源)

切分参数 (2026-08-30 已与用户确认):
  - tile 640x640, 步长512 (重叠128), 边缘 tile 对齐右/下边
  - 小图 (宽高均<640) 整图保留, 不切
  - 框重映射: 裁剪到 tile, 保留面积 >= 原框 20% 的框
  - 负样本(背景 tile): 每图最多保留 min(负样本数, 正样本数) 个; 无框图取 12
"""
import os, json, glob, random, argparse

from PIL import Image

# ════════════ 配置 ════════════
# 数据根：仓库 dataset/cscan_dataset（本脚本已迁至 backend/cscan_tools）
BASE = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "dataset", "cscan_dataset"))
RAW = os.path.join(BASE, "raw")
OUT = {k: os.path.join(BASE, k) for k in ("images", "labels", "meta")}
IMAGE_EXTS = (".bmp", ".png", ".jpg", ".jpeg")
CLASS_FILE = os.path.join(RAW, "labels.txt")

TILE = 640
STRIDE = 512          # 重叠 = TILE - STRIDE
KEEP_RATIO = 0.20     # 框裁剪后保留面积阈值(相对原框)
NEG_CAP_EMPTY_IMAGE = 12   # 无框图(纯背景)最多保留的背景 tile 数
SEED = 42

# v5 缺陷码 → 中文 (codes.json 用)
CODE_ZH = {
    "OK": "好区", "Dl": "分层", "Db": "脱粘", "Po": "孔隙",
    "Ap": "胶膜孔隙", "Vo": "气孔", "In": "夹杂", "Fb": "纤维相关",
    "Rs": "树脂相关", "Cp": "耦合不良", "Uc": "不可识别",
}
# ═══════════════════════════════


def load_classes(path):
    """读类表, 返回 [code,...]; 行号=class_id"""
    classes = []
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            classes = [ln.strip() for ln in f if ln.strip()]
    return classes


def parse_yolo(path):
    """读 YOLO txt -> [(class_id, x1,y1,x2,y2 归一化, area归一化)]"""
    boxes = []
    if not os.path.exists(path):
        return boxes
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            p = line.split()
            if len(p) != 5:
                continue
            cid, cx, cy, w, h = map(float, p)
            boxes.append((int(cid), cx - w / 2, cy - h / 2,
                          cx + w / 2, cy + h / 2, w * h))
    return boxes


def tile_starts(length):
    """滑动窗口起点列表: 0, STRIDE, ... , 最后对齐右/下边"""
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
    """框裁剪到 tile, 保留面积>=KEEP_RATIO; 返回 tile 归一化 YOLO 行.
    box 必须已是全图像素坐标; ox/oy/tw/th 为 tile 像素范围. """
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
    # 中心要转成 tile 相对坐标: 全局中心 - tile 偏移
    cx = (cx1 - ox + cx2 - ox) / 2 / tw
    cy = (cy1 - oy + cy2 - oy) / 2 / th
    return f"{cid} {cx:.6f} {cy:.6f} {w:.6f} {h:.6f}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--clean", action="store_true",
                    help="先清空 images/labels/meta 再生成")
    args = ap.parse_args()

    classes = load_classes(CLASS_FILE)
    if not classes:
        raise SystemExit(f"类表为空: {CLASS_FILE}")
    print("类表 (行号=class_id):", classes)

    # 清空输出目录(派生产物, 可重建)
    for d in OUT.values():
        os.makedirs(d, exist_ok=True)
        if args.clean:
            for f in glob.glob(os.path.join(d, "*")):
                os.remove(f)

    imgs = sorted(f for f in glob.glob(os.path.join(RAW, "*"))
                  if os.path.splitext(f)[1].lower() in IMAGE_EXTS)
    print(f"待处理原图: {len(imgs)}")

    rng = random.Random(SEED)
    stats = {"pos": 0, "neg": 0, "classes": {c: 0 for c in classes},
             "no_sidecar": [], "empty_images": []}
    total_tiles = 0

    for img_path in imgs:
        stem = os.path.splitext(os.path.basename(img_path))[0]
        yolo_path = os.path.join(RAW, stem + ".txt")
        sidecar_path = os.path.join(RAW, stem + ".json")

        sidecar = {}
        if os.path.exists(sidecar_path):
            with open(sidecar_path, encoding="utf-8") as f:
                sidecar = json.load(f)
        else:
            stats["no_sidecar"].append(stem)

        boxes = parse_yolo(yolo_path)   # 归一化坐标
        with Image.open(img_path) as im:
            W, H = im.size
            img = im.convert("RGB")
        # 归一化 -> 全图像素坐标 (remap 在像素空间进行)
        boxes = [(cid, x1 * W, y1 * H, x2 * W, y2 * H)
                 for (cid, x1, y1, x2, y2, _a) in boxes]

        # 小图(宽高均<640)整图保留; 否则切分
        if W < TILE and H < TILE:
            tiles = [(0, 0, W, H, False)]
        else:
            tiles = [(ox, oy, min(TILE, W - ox), min(TILE, H - oy), True)
                     for ox in tile_starts(W) for oy in tile_starts(H)]

        pos_tiles, neg_tiles = [], []
        for i, (ox, oy, tw, th, sliced) in enumerate(tiles):
            yolo_lines = []
            for b in boxes:
                line = remap_box(b, ox, oy, tw, th)
                if line is not None:
                    yolo_lines.append(line)
            (pos_tiles if yolo_lines else neg_tiles).append(
                (i, ox, oy, tw, th, sliced, yolo_lines))

        # 负样本限量
        if pos_tiles:
            keep = min(len(neg_tiles), len(pos_tiles))
        else:
            keep = min(len(neg_tiles), NEG_CAP_EMPTY_IMAGE)
        rng.shuffle(neg_tiles)
        chosen = pos_tiles + neg_tiles[:keep]

        for i, ox, oy, tw, th, sliced, yolo_lines in chosen:
            name = f"{stem}_t{i:03d}.png" if sliced else f"{stem}.png"
            crop = img.crop((ox, oy, ox + tw, oy + th))
            crop.save(os.path.join(OUT["images"], name))

            with open(os.path.join(OUT["labels"], os.path.splitext(name)[0] + ".txt"),
                      "w", encoding="utf-8") as f:
                if yolo_lines:
                    f.write("\n".join(yolo_lines) + "\n")

            meta = dict(sidecar)
            meta["source_raw"] = stem
            meta["tile"] = {"index": i, "offset_x": ox, "offset_y": oy,
                            "tile_w": tw, "tile_h": th, "sliced": sliced}
            with open(os.path.join(OUT["meta"], os.path.splitext(name)[0] + ".json"),
                      "w", encoding="utf-8") as f:
                json.dump(meta, f, ensure_ascii=False, indent=2)

            total_tiles += 1
            if yolo_lines:
                stats["pos"] += 1
                for ln in yolo_lines:
                    cid = int(ln.split()[0])
                    stats["classes"][classes[cid]] += 1
            else:
                stats["neg"] += 1

        if not boxes:
            stats["empty_images"].append(stem)

    # codes.json (class_id ↔ 缺陷码 ↔ 中文)
    codes = [{"id": i, "code": c, "zh": CODE_ZH.get(c, c)} for i, c in enumerate(classes)]
    with open(os.path.join(BASE, "codes.json"), "w", encoding="utf-8") as f:
        json.dump(codes, f, ensure_ascii=False, indent=2)

    print(f"\n总 tile 数: {total_tiles}")
    print(f"  正样本(含缺陷): {stats['pos']}  负样本(背景): {stats['neg']}")
    print(f"  类框数: {stats['classes']}")
    if stats["no_sidecar"]:
        print(f"  ⚠ 缺边车 JSON: {stats['no_sidecar']}")
    if stats["empty_images"]:
        print(f"  (无框纯背景图): {stats['empty_images']}")
    print(f"codes.json 已生成: {os.path.join(BASE, 'codes.json')}")


if __name__ == "__main__":
    main()
