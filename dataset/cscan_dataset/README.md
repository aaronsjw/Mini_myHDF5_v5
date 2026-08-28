# CScan 数据集（cscan_dataset）

复合材料超声 **C 扫图像缺陷检测** 数据集（YOLOv8 目标检测）。
本目录是 CScan 数据的根，与 `dataset/ascan_dataset`（AScan 波形数据）并列，同属 `dataset/` 数据根容器。

---

## 1. 目录结构

```
dataset/cscan_dataset/
├── images/
│   ├── train/                # 训练图（原始 C 扫图切分/增广产物）
│   └── val/                  # 验证图
├── labels/
│   ├── train/                # YOLO txt 标签（每行: class_id cx cy w h）
│   └── val/                  # 归一化坐标
├── meta/
│   ├── train/                # 边车 JSON，与 images 同名配对
│   └── val/                  #   {method, structure, defect, damage_type, probe, wave, part}
├── raw/                      # E盘原始数据归档（原始图 + .dat，可追溯/重新成像）
├── tools/                    # 脚本：raw→切分→重命名→标注重映射→增广
├── dataset.yaml              # YOLO 配置（数据就绪后自动生成）
├── codes.json                # class_id ↔ v5缺陷码 ↔ 中文 映射表（自动生成）
└── README.md
```

## 2. 设计决策（2026-08-28 已定）

| 决策点 | 结论 |
|--------|------|
| 数据来源 | E盘原始 74 张完整 C 扫图（含 .dat 原始数据），重新切分/标注/增广 |
| 类别体系 | 检测框映射到 **v5 缺陷码**（Dl 分层 / Db 脱粘 / Po 孔隙…）|
| 检测粒度 | 冲击/雷击等细粒度**不占独立类**，作为元数据写入边车 JSON（`damage_type`）|
| 元数据载体 | 文件名分段（核心字段）+ 边车 JSON（详细字段）|
| 目录规划 | `dataset/` 数据根容器下 `ascan_dataset/` + `cscan_dataset/` 并列 |

## 3. 文件命名规则

沿用 AScan 的分段式命名，但只放能确定的字段：

```
{方法}_{结构}_{缺陷}_{部件}_{探头}_{序号}.jpg
WRUT_BondPP_Db_T形筋板_5M_01.jpg
```

字段映射（来自 E盘原始文件夹/文件名）：

| 字段 | 值 | 含义 |
|------|-----|------|
| 方法 | WRUT / WPUT / PAUT / AUT | 反射 / 穿透 / 相控阵 / 空耦 |
| 结构 | Plate / BondPP / BondSC | 平板 / 板板胶接 / 板芯胶接 |
| 缺陷 | Dl / Db / Po … | v5 缺陷码（检测输出标签）|
| 部件 | 如 T形筋板 / 5件蜂窝 / 对比试块 | 来源部件描述 |
| 探头 | 1M / 5M / 2mm | 探头频率/规格 |
| 序号 | 01, 02, … | 同源图切分后的顺序号 |

## 4. 边车 JSON schema（meta/ 下，与图片同名）

```json
{
  "filename": "WRUT_BondPP_Db_T形筋板_5M_01.jpg",
  "method": "WRUT",
  "structure": "BondPP",
  "defect": "Db",
  "damage_type": "impact",
  "probe": "5M",
  "wave": "底波",
  "part": "T形筋板",
  "source_raw": "超声C扫_反射_板板脱粘_T形筋板板板胶接/xxx.BMP",
  "note": "板板胶接下板，T向上"
}
```

## 5. 待办

- [ ] E盘原始数据导入 raw/（含 .dat 归档）
- [ ] tools/ 脚本：raw 图切分 + 按命名规则重命名
- [ ] 缺陷框标注（并入 v5 缺陷码）
- [ ] 边车 JSON 生成
- [ ] train/val 划分 + dataset.yaml + codes.json 生成
- [ ] 接入 v5 后端 CScan 管线（cscan_yolo.py，见 `超声CScan功能增加.md`）
