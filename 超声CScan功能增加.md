# 把超声 C-Scan（YOLOv8）智能判定集成进 Mini_myHDF5_v5

## Context（为什么做）

v5 系统目前只基于 **A-Scan（64×2000 时域信号）** 做缺陷分类（RF 5类 Cp/Db/Dl/OK/Po）+ DeepSeek AI 对话 + 验收判定。验收引擎里 `needs_cscan` / `cscan_criteria` / `cscan_action` 字段已预留，但**只透传不计算**：AScan 给不出缺陷物理尺寸，所以分层/脱粘/孔隙等 6 类缺陷永远只能返回"无法判定，需补充尺寸信息"。

`E:\Work\课题\2026年\★★★课题\2_制造院人工智能专项首批项目_AI院基金\5_哈工大\无损检测C扫` 下有一个 YOLOv8 C 扫描缺陷识别项目：8 类缺陷（Board separation / core delamination / delamination / delamination or debonding / impact / lightning damage / stratified or impact damage / debonding），572 张已标注图（400 训练/172 验证）。但**无可用训练权重**（根目录 yolov8s.pt 已损坏、weights/ 是 COCO 预训练 80 类）、无尺寸测量、无合格判定逻辑，且 `yolov8.py` 有 `CLASS_NAMES` 未定义的 bug。
草稿_
目标：把 YOLOv8 接进 v5，让 C 扫图像提供**缺陷定位 + 物理尺寸**，配合已有的 A 扫缺陷类型，真正完成"超标/合格"验收判定，并让 AI 对话能综合 A扫+C扫 给出结论。

## 用户已确认的决策

1. **集成深度**：独立 C-Scan 面板（替换 App.jsx 占位菜单）+ 接入 AI 对话（EvaluationPanel 的 DeepSeek 引用 C扫结果综合判定）。
2. **类别映射**：YOLO 8类 → v5 现有缺陷类型。映射：Board separation→脱粘、core delamination→分层、delamination→分层、debonding→脱粘、delamination or debonding→分层或脱粘（取置信度高者）、impact→分层、lightning damage→分层、stratified or impact damage→分层。
3. **缺陷以 v5 为准**：缺陷类型的权威来源是 v5 的 A扫分析/模型预测；YOLO 类别只作参考/定位，C扫主要贡献物理尺寸。若已加载 .nde 用其 A扫预测类型，否则回退 YOLO 映射。
4. **权重**：方案包含训练步骤（装 ultralytics → 用 C扫项目 572 图训练 yolov8s → best.pt）。
5. 环境：后端跑在 `F:\Users\aaron\anaconda3\envs\ascan_env`（torch 2.0.1+cu118 已装，**ultralytics 未装**，cv2 已装）。

## 阶段总览

Phase 0 训练（独立先行）→ Phase 1 `cscan_yolo.py`（新模块）→ Phase 2 验收引擎扩展 + summary.json → Phase 3 `main.py` 端点 → Phase 4 AI 对话接入 → Phase 5 前端 → Phase 6 验证。

---

## Phase 0 — YOLO 训练（产出 best.pt）

在 C扫项目目录（不改 v5）：
1. `yolov8.py` 顶部常量区加 `CLASS_NAMES = [8个英文类名]`（修复第 74/114 行 NameError）；`DATASET_YAML` 改为 C扫项目实际绝对路径；`MODEL_TYPE = "yolov8s.pt"`（用 `weights/` 下有效的，勿用根目录已损坏的）。
2. `YOLO_Dataset/dataset.yaml` 的 `train:`/`val:` 改为本机 `images/train`、`images/val` 绝对路径（当前指向不存在的 `E:\新建文件夹\...`）。

命令：
```bash
cd "E:\...\无损检测C扫"
F:\Users\aaron\anaconda3\envs\ascan_env\Scripts\pip.exe install ultralytics
# 若与 torch 2.0.1 冲突回退：pip install "ultralytics>=8.0,<8.4"
set PYTHONIOENCODING=utf-8
F:\Users\aaron\anaconda3\envs\ascan_env\python.exe -X utf8 yolov8.py
copy "YOLOv8_Defect_Multiclass\defect_multiclass_train\weights\best.pt" "F:\Learn\learn_torch\test\Mini_myHDF5_v5\backend\cscan_models\best.pt"
```

**验证**：日志出现逐类 mAP，best.pt 存在且 `zipfile` 能打开。

---

## Phase 1 — 新建 `backend/cscan_yolo.py`

**懒加载 ultralytics**（try/except，`ULTRALYTICS_AVAILABLE` 标志，无 torch 环境 import 不炸，与 trainer 的 torch try/except 一致）。常量：`CSCAN_CLASS_NAMES`（8英文）、`CSCAN_CLASS_TO_V5`（上面映射）、`V5_ABBR_TO_ZH`（Cp=耦合不良/Db=脱粘/Dl=分层/Po=孔隙/Vo=气孔/In=夹杂/Fb=纤维相关/Rs=富树脂/OK=无缺陷/Uc=不可分类）、`CSCAN_MODELS_DIR=backend/cscan_models`。

关键函数：
```python
def ultralytics_available() -> bool
def list_cscan_models() -> list[dict]                 # [{name,path,size_bytes,mtime_iso}]，倒序
def _get_model(model_path) -> YOLO                    # 模块级缓存 _MODEL_CACHE
def analyze_cscan(image_path, model_path, mm_per_px=None, conf=0.5, iou=0.5) -> dict
def resolve_v5_type_from_yolo(detections) -> (zh_type, abbr)   # AMB 类取两类置信度和高者
def build_cscan_features(detections, stats) -> dict   # 产出 cscan_* 键
def draw_boxes(image_path, detections, out_path) -> str  # cv2 画框落盘（可选后备，不接 StaticFiles）
```

`analyze_cscan` 返回：
```python
{
  "model": {...}, "image": {"width","height","physical_w_mm","physical_h_mm"},
  "mm_per_px": float|None,
  "detections": [{ "index","class_id","class_name_en","class_name_zh",
     "v5_defect_type","v5_defect_abbr","confidence","xyxy":[x1,y1,x2,y2],
     "w_px","h_px","w_mm","h_mm","z_mm",   # z=(w_mm+h_mm)/2，对应标准 Z=(X+Y)/2
     "area_mm2","area_pct" }],
  "stats": { "count","total_area_mm2","total_area_pct","max_z_mm","max_dim_mm",
     "min_edge_gap_mm",   # 两缺陷框边缘最小间距（<2框为None）
     "per_class":[{class_id,class_name_zh,count,max_z_mm,total_area_mm2,total_area_pct}] },
}
```
要点：`model.predict(source, imgsz=640, conf, iou, device, verbose=False)`，`xyxy` 用 **原图像素坐标**（勿除以640）；对类 id 不在 0..7 的容错（COCO 权重也能跑）；`mm_per_px` 为空时 mm 字段/area_pct 为 None。

---

## Phase 2 — 验收引擎扩展 + summary.json 结构化阈值

### 2a. `backend/acceptance_checker.py`（修改）
- `check()` 开头取 `grade = detection_result.get("grade") or standard.get("default_grade","C")`。
- `needs_cscan` 分支（现 173-176 行）改为**三分支**：
  - 调 `_eval_cscan(criteria, features, grade)` 得 `cscan_violations`（尺寸超限/间距不足）。
  - 有 cscan_violations → `passed=False`（"不合格（CScan 尺寸判定）：..."）。
  - 否则若携带了 cscan 尺寸特征（`cscan_z_value`/`cscan_area_pct`/`cscan_max_dim_mm` 任一非 None）→ `passed=True`（"合格（含 CScan 尺寸判定）..."）。
  - 否则维持现状 `passed=None`（"无法判定，需补充尺寸信息"）。→ **保留无尺寸时的原行为**。
- 新增 `_eval_cscan(criteria, features, grade)`：读 `criteria["cscan_thresholds"]`，比较 `grade_field`（或 `grade_field2`）特征值 vs `grade_values[grade]`，超限产出 action=criteria.cscan_action 的违规；`edge_field` 小于 `edge_min` 产出"警告：应合并计算"。fatal 信号违规仍优先判不合格。
- 返回 dict 追加 `"cscan_grade": grade`、`"cscan_evaluated": bool`。

### 2b. `standards/HB/summary.json`（数据修改）
给 6 个 `needs_cscan:true` 的缺陷项加机器可判读 `cscan_thresholds`（数值取自各自 cscan_criteria 文本，已核实）：
- **分层 / 夹杂 / 气孔**（Z值判据）：
  `{"grade_field":"cscan_z_value","grade_values":{"A":10,"B":13,"C":19},"compare":">","edge_field":"cscan_edge_gap_min_mm","edge_min":100,"action":"不合格"}`
  （气孔文字无间距要求，edge_field 可省）
- **孔隙 / 富树脂**（面积占比判据，表6）：
  `{"grade_field":"cscan_area_pct","grade_values":{"A":10,"B":15,"C":25},"compare":">","action":"不合格"}`
- **脱粘**（表5 Z值 + 表6 面积占比双判据）：
  `{"grade_field":"cscan_z_value","grade_field2":"cscan_area_pct","grade_values":{"A":10,"B":13,"C":19},"grade_values2":{"A":10,"B":15,"C":25},"compare":">","edge_field":"cscan_edge_gap_min_mm","edge_min":100,"action":"不合格"}`
  （`_eval_cscan` 对 grade_field / grade_field2 各判一次，任一超限即违规）

---

## Phase 3 — `backend/main.py` 端点

顶部 `from cscan_yolo import (ultralytics_available, list_cscan_models, analyze_cscan, resolve_v5_type_from_yolo, build_cscan_features, V5_ABBR_TO_ZH)`。

### `GET /cscan/models`
返回 `{"available": bool, "models": list_cscan_models(), "note": ...}`。

### `POST /cscan/analyze`（multipart：`file` jpg/png、`mm_per_px` 可选、`model` 可选、`standard_id` 可选、`grade` 可选）
流程：
1. `ultralytics_available()` 为 False → `{"error":"ultralytics 未安装..."}`。
2. 上传存临时文件；模型缺省取 `list_cscan_models()[0]`；无模型 → 提示先 Phase 0。
3. `res = analyze_cscan(tmp, model_path, mm_per_px)`。
4. **权威缺陷类型（缺陷以 v5 为准）**：
   - `current_file` 存在且有模型 → `predict_single_file(current_file, best_model)` 取 `prediction`（如 "Dl"），`authoritative_defect_type = V5_ABBR_TO_ZH[pred]`，source=`"v5_ascan"`；同时 `analyze_signal(current_file)` 取 A扫数值特征。
   - 否则 → `resolve_v5_type_from_yolo(res["detections"])`，source=`"yolo_map"`。
   - v5 判 OK 但 YOLO 有检出 → `discrepancy_warning`。
5. 合并特征：`merged_features = {A扫数值键} ∪ build_cscan_features(...)`（cscan_* 覆盖）。
6. 验收：`standard_id` 缺省用 `checker.suggest_standard(meta)` 或 index[0]；`checker.check(standard_id, {"defect_type":权威中文, "defect_type_en":abbr, "confidence":..., "signal_features":merged_features, "grade":grade})`。

响应：
```python
{ "cscan": {...}, "v5_context": {has_nde, filename, ascan_defect_type, ascan_defect_abbr, ascan_confidence, signal_features},
  "merged_features": {...}, "authoritative_defect_type", "authoritative_defect_abbr", "authoritative_source": "v5_ascan"|"yolo_map",
  "acceptance": {...}|None, "discrepancy_warning": str|None, "warnings": [str] }
```

**重判**：不新增 `/cscan/acceptance`。改 mm_per_px/grade 后前端把 merged_features 回传给现有 `/acceptance/check`（给它的 `req` 增加可选 `grade` 字段，透传进 detection_result）即可。

---

## Phase 4 — AI 对话接入

### `backend/prompts.py` 新增 `build_cscan_block(cscan_context) -> str`
纯字符串拼接，风格同 `build_acceptance_result_block`：
- `## C-Scan 检测结果`：权威缺陷类型 + 来源（v5_ascan/yolo_map）、图像物理尺寸、mm_per_px。
- 检测框表：序号/中文类别/置信度/w×h(mm)/面积(mm²)。
- 统计：缺陷数、总面积、面积占比、最大 Z、最小间距。
- A扫上下文（defect_type/置信度/关键 signal_features）。
- 指令：结合 A扫类型 + C扫尺寸给综合判定，若 acceptance 存在引用其结果，冲突时提示人工复核。

### `backend/main.py` `/chat/ask`
- 请求体读可选 `cscan_context`；关键词检测 `['C扫','cscan','C扫描','C-Scan','C图','C 扫']`。
- 携带 context → `system_prompt += build_cscan_block(ctx)` +（若有 acceptance）`build_acceptance_result_block(...)`；仅关键词无 context → 提示去 C-Scan 面板上传。

---

## Phase 5 — 前端

### 新建 `frontend/src/components/CScanPanel.jsx`
- 挂载时 `GET /cscan/models` 填模型下拉。
- 上传图（antd Upload，beforeUpload 返回 false 阻止自动上传）+ `URL.createObjectURL`。
- 表单：mm_per_px 数字输入、模型下拉、grade A/B/C 选择。
- "开始识别" → `FormData` `POST /cscan/analyze`。
- **画框用前端 canvas**（不引入后端 StaticFiles）：image.onload 后 `ctx.drawImage`，按 `scale=canvasW/naturalW` 遍历 `result.cscan.detections` `strokeRect(x1*s,y1*s,(x2-x1)*s,(y2-y1)*s)` + `fillText("类别 置信度")`。
- 结果区：antd Table（序号/类别/置信度/w×h(mm)/面积 mm²/占比）、Descriptions 统计、验收 `Alert`（passed true=合格绿/false=不合格红/null=无法判定橙 + reason + 违规条款 + suggestions）。
- v5 关联提示：`v5_context.has_nde` → Tag"已关联 A扫：{类型}"，否则提示"缺陷类型为 YOLO 推断（以 v5 为准）"。
- "发送给AI评估"按钮 → `onSendToAI(result)`。

### `frontend/src/App.jsx`（修改）
- 新增 state `cscanContext`、`analysisPrefill`；`handleCscanSendToAI(ctx)`：setCscanContext + 切到 `analysis` + 预填提问"请结合 A 扫信号与 C 扫尺寸对当前缺陷做综合判定，并给出验收结论。"。
- dataset 模块（611 行分支后）加：`if (datasetPath === 'ultrasonic/cscan') return <CScanPanel onSendToAI={handleCscanSendToAI} />`（替代 613 行占位符）。
- 639 行改 `<EvaluationPanel cscanContext={cscanContext} prefill={analysisPrefill} />`。

### `frontend/src/components/EvaluationPanel.jsx`（修改）
- 签名加 `cscanContext = null, prefill = ''`；`useEffect` 在 `prefill && !inputText` 时填输入框。
- `/chat/ask` 请求体追加 `cscan_context: cscanContext`。
- cscanContext 非空时显示"📎 C扫上下文已接入"Tag。

---

## Phase 6 — 验证

1. **语法级**（基础 Python，无 torch）：
   ```bash
   python -X utf8 -c "import ast,io; [ast.parse(io.open(f,encoding='utf-8').read(),f) for f in ['backend/main.py','backend/cscan_yolo.py','backend/acceptance_checker.py','backend/prompts.py']]; print('syntax OK')"
   ```
   直接 `import cscan_yolo` 应成功且 `ultralytics_available()==False`（懒加载验证）；main.py 因 trainer 引 nn 只能 ast.parse（既有约束）。
2. **ascan_env 冒烟**（装好 ultralytics 后、训练前）：用 64×64 黑图 + COCO `weights/yolov8s.pt` 跑 `analyze_cscan`，断言返回结构完整、0 检出、无 NameError（临时文件用后删）。
3. **训练后全链路**：ascan_env 起 uvicorn → `POST /upload` 传 `dataset/Dl/` 下 .nde → `POST /cscan/analyze`（file=C扫 val 图，mm_per_px=0.5，model=best.pt）→ 断言 `acceptance.passed` 不再是 None；改 mm_per_px/grade 重发确认 passed 随尺寸变化 → 前端 CScan 面板画框/表格/判定卡片 → "发送给AI评估"自动切面板、AI 流式引用 C扫尺寸。
4. **编码坑**：所有命令 `python -X utf8` 或 `set PYTHONIOENCODING=utf-8`（GBK 控制台 print emoji/中文会炸）；新增后端代码日志用 ASCII。

## Critical Files
- 新建：`backend/cscan_yolo.py`、`backend/cscan_models/`（权重目录）、`frontend/src/components/CScanPanel.jsx`
- 修改：`backend/main.py`、`backend/acceptance_checker.py`、`backend/prompts.py`、`standards/HB/summary.json`、`frontend/src/App.jsx`、`frontend/src/components/EvaluationPanel.jsx`
- C扫项目：`yolov8.py`、`YOLO_Dataset/dataset.yaml`（训练前置，不属 v5）
