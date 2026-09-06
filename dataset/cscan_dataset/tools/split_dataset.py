"""
CScan 训练集划分: 按原图(source_raw)分组随机 80/20, 防数据泄漏.

输入:  dataset/cscan_dataset/{images,labels,meta}/   (slice_remap.py 产物)
       codes.json   class_id ↔ 缺陷码 ↔ 中文
输出:  dataset/cscan_dataset/{train.txt, val.txt, dataset.yaml}

划分哲学 (README §5): 训练时划分, 不预锁 train/val;
同一原图的所有 tile 必须同组, 否则相似片段跨 train/val 造成数据泄漏、指标虚高.
"""
import os, json, glob, random, argparse

BASE = os.path.normpath(os.path.join(os.path.dirname(__file__), ".."))
IMAGES = os.path.join(BASE, "images")
LABELS = os.path.join(BASE, "labels")
META = os.path.join(BASE, "meta")
CODES = os.path.join(BASE, "codes.json")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=42, help="随机种子, 固定可复现")
    ap.add_argument("--val-ratio", type=float, default=0.2)
    ap.add_argument("--require-all-classes", action="store_true",
                    help="在 seed 0..99 中搜索, 使 train/val 都覆盖全部类别")
    args = ap.parse_args()

    codes = json.load(open(CODES, encoding="utf-8"))
    names = {c["id"]: c["code"] for c in codes}
    all_classes = set(names)

    # 按 source_raw 聚合每个原图的 tile 与类别
    src_info = {}
    for mf in glob.glob(os.path.join(META, "*.json")):
        m = json.load(open(mf, encoding="utf-8"))
        src = m.get("source_raw")
        if not src:
            continue
        stem = os.path.splitext(os.path.basename(mf))[0]
        cls = set()
        lf = os.path.join(LABELS, stem + ".txt")
        if os.path.exists(lf):
            with open(lf, encoding="utf-8") as f:
                for ln in f:
                    ln = ln.strip()
                    if ln:
                        cls.add(int(ln.split()[0]))
        info = src_info.setdefault(src, {"tiles": [], "classes": set()})
        info["tiles"].append(stem + ".png")
        info["classes"].update(cls)

    srcs = sorted(src_info)

    def split_srcs(seed):
        rng = random.Random(seed)
        order = list(srcs)
        rng.shuffle(order)
        n_val = max(1, round(len(order) * args.val_ratio))
        return set(order[:n_val])

    def classes_in(src_set):
        out = set()
        for s in src_set:
            out |= src_info[s]["classes"]
        return out

    chosen = args.seed
    if args.require_all_classes:
        for seed in range(100):
            vs = split_srcs(seed)
            if classes_in(vs) == all_classes and classes_in(set(srcs) - vs) == all_classes:
                chosen, val_srcs = seed, vs
                break
        else:
            print("⚠ 0..99 内未找到 train/val 都含全部类别的 seed, 退回默认 seed")
            chosen, val_srcs = args.seed, split_srcs(args.seed)
    else:
        val_srcs = split_srcs(chosen)

    train_srcs = set(srcs) - val_srcs
    train_tiles, val_tiles = [], []
    for s in srcs:
        target = val_tiles if s in val_srcs else train_tiles
        # ./ 前缀: ultralytics 会把相对行转成绝对路径(相对 train.txt 所在目录),
        # 否则相对路径 images\xxx.png 因 img2label_paths 匹配不到 "\images\" 而丢标签
        target += [f"./images/{t}" for t in src_info[s]["tiles"]]

    # 写 train.txt / val.txt
    with open(os.path.join(BASE, "train.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(sorted(train_tiles)) + "\n")
    with open(os.path.join(BASE, "val.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(sorted(val_tiles)) + "\n")

    # 写 dataset.yaml
    yaml_lines = [
        f"path: {BASE.replace(os.sep, '/')}",
        "train: train.txt",
        "val: val.txt",
        "names:",
    ]
    for cid in sorted(names):
        yaml_lines.append(f"  {cid}: {names[cid]}")
    with open(os.path.join(BASE, "dataset.yaml"), "w", encoding="utf-8") as f:
        f.write("\n".join(yaml_lines) + "\n")

    # ── 报告 ──
    def box_stats(tile_paths):
        from collections import Counter
        c = Counter()
        for tp in tile_paths:
            stem = os.path.splitext(os.path.basename(tp))[0]
            lf = os.path.join(LABELS, stem + ".txt")
            if os.path.exists(lf):
                with open(lf, encoding="utf-8") as f:
                    for ln in f:
                        ln = ln.strip()
                        if ln:
                            c[int(ln.split()[0])] += 1
        return c

    n_tiles = len(train_tiles) + len(val_tiles)
    leak = train_srcs & val_srcs
    print(f"seed={chosen}  val_ratio={args.val_ratio}")
    print(f"原图组: {len(srcs)}   总 tile: {n_tiles}")
    print(f"train: {len(train_srcs)} 组 / {len(train_tiles)} tile    "
          f"val: {len(val_srcs)} 组 / {len(val_tiles)} tile")
    print(f"数据泄漏检查(同源跨集): {'无 ✅' if not leak else f'有! {leak}'}")
    print(f"train 框: {dict(box_stats(train_tiles))}")
    print(f"val   框: {dict(box_stats(val_tiles))}")
    vt = classes_in(val_srcs); tr = classes_in(train_srcs)
    missing_val = all_classes - vt
    if missing_val:
        print(f"⚠ val 缺类别: {[names[c] for c in missing_val]}  (加 --require-all-classes 重跑)")
    else:
        print(f"val 类别覆盖: 全部 ✅  {sorted(vt)}")


if __name__ == "__main__":
    main()
