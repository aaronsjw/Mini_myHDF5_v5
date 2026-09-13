# CScan 数据集（cscan_dataset）

复合材料超声 **C 扫图像缺陷检测** 数据集（YOLOv8 目标检测）。
本目录是 CScan 数据的根，与 `dataset/ascan_dataset`（AScan 波形数据）并列，同属 `dataset/` 数据根容器。

---

## 1. 目录结构

```
dataset/cscan_dataset/
├── images/                   # 所有处理后的片段图（不预分 train/val）
├── labels/                   # 对应 YOLO txt 标签（每行: class_id cx cy w h，归一化坐标）
├── meta/                     # 边车 JSON，与 images 同名配对
│                             #   {method, structure, defect, damage_type, probe, wave, part, source_raw}
├── raw/                      # E盘原始数据归档（原始图 + .dat，保留来源文件夹层级）
├── dataset.yaml              # YOLO 配置（每次训练由 split_dataset.py 生成）
├── codes.json                # class_id ↔ v5缺陷码 ↔ 中文 映射表（自动生成）
└── README.md
```

> **没有预划分的 train/val 目录**。所有处理后的片段单一存放，训练时用 `backend/cscan/tools/split_dataset.py` 按「原图」分组随机 80/20，像 AScan 的 train_test_split 一样每次随机。详见「第 5 节 训练时划分」。

## 2. 设计决策（2026-08-28 已定）

| 决策点 | 结论 |
|--------|------|
| 数据来源 | E盘原始 74 张完整 C 扫图（含 .dat 原始数据），重新切分/标注/增广 |
| 类别体系 | 检测框映射到 **v5 缺陷码**（Dl 分层 / Db 脱粘 / Po 孔隙…）|
| 检测粒度 | 冲击/雷击等细粒度**不占独立类**，作为元数据写入边车 JSON（`damage_type`）|
| 元数据载体 | 文件名分段（核心字段）+ 边车 JSON（详细字段）|
| 目录规划 | `dataset/` 数据根容器下 `ascan_dataset/` + `cscan_dataset/` 并列 |
| 划分策略 | **不预锁 train/val**，训练时按原图分组随机 80/20（同 AScan 的 train_test_split 哲学）|

## 3. 文件命名规则

**与 AScan 完全一致**：`{纤维}_{基体}_{结构}_{方法}_{缺陷}_{型号}_{时间戳}_{纤维牌号}_{基体牌号}`，未知字段用 `NaN` 占位。这样 CScan 文件名与 AScan 同构，可被相同的分段逻辑解析。

```
{fiber}_{matrix}_{structure}_{method}_{defect}_{model}_{timestamp}_{fiberGrade}_{matrixGrade}.ext
CF_EP_Plate_WPUT_Dl_SYJ_20220320153106_NaN_NaN.png
```

| 段 | 值 | 说明 |
|----|-----|------|
| fiber | CF / GF … | 纤维类型，未知填 NaN |
| matrix | EP … | 基体类型，未知填 NaN |
| structure | Plate / BondPP / BondSC | 平板 / 板板胶接 / 板芯胶接 |
| method | WRUT / WPUT / PAUT / AUT | 反射 / 水穿透 / 相控阵 / 空耦 |
| defect | Dl / Db / Po … | v5 缺陷码 |
| model | SYJ / Z109 … | 型号，从原文件名提取 |
| timestamp | 14位 YYYYMMDDHHMMSS | 采样时间（文件名日期或文件 mtime）|
| fiberGrade / matrixGrade | QW280 / 1316 … | 材料牌号，未知填 NaN |

**部件、探头、波型、冲击/雷击粒度等不进文件名**，全部放边车 JSON。

## 4. 边车 JSON schema（meta/ 下，与图片同名）

```json
{
  "fiber": "CF",
  "matrix": "EP",
  "fiberGrade": "NaN",
  "matrixGrade": "NaN",
  "structure": "Plate",
  "method": "WPUT",
  "defectType": "Dl",
  "code": "SYJ",
  "probe_type": "1M water through-transmission",
  "description": "冲击损伤——16.7dB——喷水穿透_平板_分层_1M探头_型号SYJ_...png"
}
```

字段 = 文件名 9 段 + probe_type + description（损伤类型——增益——原文件名）。时间戳与图片名在文件名/边车同名中，JSON 不重复。

## 5. 训练时划分（split_dataset.py）

划分发生在**训练时**，不预锁 train/val。关键：**按原图分组，不按片段**。

```
74 组原图（按 meta 的 source_raw 分组）
        │  随机 80/20（--seed 可固定复现）
        ▼
train 组（~59 原图的全部片段）          val 组（~15 原图的全部片段）
        │                                      │
        ▼                                      ▼
   train.txt（路径清单）                  val.txt（路径清单）
        └──────────────►  dataset.yaml（train: train.txt, val: val.txt）
```

- 同一原图的片段**必须同组**，否则相似片段跨 train/val 造成数据泄漏、指标虚高
- `dataset.yaml` 的 `train:`/`val:` 指向文本清单文件，片段无需重复存放
- 每次运行划分不同（val 变化），与 AScan 行为一致；固定 `--seed` 可复现
- 若需最终报告的固定测试集，后续加 `--holdout` 选项即可

## 6. 待办

- [ ] E盘原始数据导入 raw/（含 .dat 归档，保留来源文件夹层级）
- [ ] backend/cscan/tools/slice_remap.py：raw 图切分 + 按命名规则重命名（片段→ images/）
- [ ] 缺陷框标注（并入 v5 缺陷码）
- [ ] 边车 JSON 生成（含 source_raw 分组键）
- [ ] backend/cscan/tools/split_dataset.py：按原图分组随机划分 + 生成 dataset.yaml/codes.json
- [ ] 接入 v5 后端 CScan 管线（cscan_yolo.py，见 `超声CScan功能增加.md`）
