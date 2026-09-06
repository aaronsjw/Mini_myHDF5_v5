
# Mini-myHDF5 v5 NDE Edition

## Features

- HDF5 / CSV / NDE viewer
- Real tree structure
- JSON pretty viewer
- A-Scan waveform viewer
- B-Scan heatmap viewer
- [64,1,2000] tensor support
- Frame slider
- Dataset metadata
- attrs viewer
- Industrial dark UI

## 项目结构

```
Mini_myHDF5_v5/
├── backend/                              # Python 后端 (FastAPI)
│   ├── main.py                           # API 入口 + 路由
│   ├── trainer.py                        # 模型训练 + 报告生成 + 委托单解析
│   ├── signal_analysis.py                # 超声信号特征提取
│   ├── acceptance_checker.py             # 验收标准检查
│   ├── deepseek_client.py                # DeepSeek LLM 客户端
│   ├── requirements.txt                  # Python 依赖
│   ├── .env                              # 环境变量（API Key 等）
│   ├── models/                           # 训练好的模型文件 (.pt/.pkl/.json)
│   ├── reports/                          # 自动生成的检测报告 (.docx)
│   └── disputes/                         # 争议记录
│
├── frontend/                             # React 前端 (Vite)
│   ├── src/
│   │   ├── App.jsx                       # 根组件
│   │   ├── main.jsx                      # 入口
│   │   ├── components/
│   │   │   ├── AScanViewer.jsx           # A-Scan 波形查看器
│   │   │   ├── AScanPlayer.jsx           # A-Scan 回放器
│   │   │   ├── HeatmapViewer.jsx         # B-Scan / C-Scan 热力图
│   │   │   ├── MatrixViewer.jsx          # 矩阵数据查看器
│   │   │   ├── EvaluationPanel.jsx       # 智能评估面板
│   │   │   ├── TrainingPanel.jsx         # 模型训练面板
│   │   │   ├── TestingPanel.jsx          # 模型测试面板
│   │   │   ├── InspectPanel.jsx          # 数据检测面板
│   │   │   └── DatabaseOverview.jsx      # 数据库总览
│   │   └── 草稿/                         # 历史备份草稿
│   ├── public/                           # 静态资源
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
│
├── dataset/                              # 超声检测数据集根容器
│   ├── ascan_dataset/                    # AScan 波形数据 (.nde 格式)
│   │   ├── Cp/                           # 气孔缺陷
│   │   ├── Db/                           # 脱粘缺陷
│   │   ├── Dl/                           # 分层缺陷
│   │   ├── Fb/                           # 外来物
│   │   ├── In/                           # 夹杂
│   │   ├── OK/                           # 无缺陷
│   │   ├── Po/                           # 孔隙
│   │   ├── Rs/                           # 树脂
│   │   ├── Vo/                           # 空洞
│   │   └── TODO/                         # 待标注数据
│   └── cscan_dataset/                    # CScan 图像数据 (YOLO 检测)
│       ├── images/                       # 处理后的片段图（训练时再划分）
│       ├── labels/                       # YOLO txt 标签
│       ├── meta/                         # 边车 JSON 元数据
│       ├── raw/                          # 原始 C 扫数据归档 (含 .dat)
│       ├── tools/                        # 数据准备脚本（含 split_dataset.py）
│       └── README.md                     # CScan 数据集设计说明
│
├── standards/                            # 检测标准文档
│   ├── GJB/                              # 国军标 (GJB 1038.1A-2004)
│   └── HB/                               # 航空标准 (HB 7224-2020)
│
├── templates/                            # Word 模板
│   ├── 超声检测报告.docx                  # 检测报告模板（含占位符）
│   └── 委托单模板.doc                     # 委托单模板
│
├── samples/                              # 参考示例
│   ├── WS-2022-1998J委托单.doc            # 委托单填写示例
│   └── WS-2022-1998J报告.doc              # 报告生成示例
│
├── sci.md                                # SCI 论文思路与方向规划
├── update_nde.py                         # .nde 文件格式更新工具
├── 研究报告.md                            # 研究报告（精简版）
├── 研究报告2.md                           # 研究报告（完整版）
├── 验收文件.md                            # 验收文件
├── 会话记录_20260611-0614.md              # 开发会话记录
├── .gitignore
└── README.md
```

## Backend

```bash
f:\Users\aaron\anaconda3\Scripts\activate && conda activate cscan_env
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```

## Frontend

```bash
cd frontend
npm install --legacy-peer-deps   # react-json-view 要求 react≤17，与 react18 冲突，须用 legacy-peer-deps
npm run dev
```


## CScan 环境（cscan_env）

CScan（YOLOv8）需要独立环境 `cscan_env`：Python 3.10 + torch(CUDA 11.8) + ultralytics。cscan_env 是 ascan_env 的完整超集，**AScan 和 CScan 都可在此环境下运行**（ascan_env 保留作默认/回退环境，两者互不影响）。

### 1. 创建环境

```bash
conda create -n cscan_env python=3.10 -y
conda activate cscan_env
```

### 2. 安装 v5 后端依赖

```bash
cd backend
python -s -m pip install -r requirements.txt
```

### 3. 安装 PyTorch（CUDA 11.8）

> ⚠️ 必须用 pip 装 `+cu118` 构建，且 torch 与 torchvision 版本严格对应。
> **不要用 `conda install pytorch torchvision torchaudio -c pytorch`** —— 会解析成 CPU 版（`*_cpu_0`），并把已装好的 cu118 torch 覆盖掉。

```bash
python -s -m pip install torch==2.0.1+cu118 torchvision==0.15.2+cu118 --index-url https://download.pytorch.org/whl/cu118
```

版本对应关系：`torch 2.0.1 ↔ torchvision 0.15.2`（同为 `+cu118`）。装错版本会导致 DLL 加载失败（WinError 127）、torchvision 被降级成 CPU 版，或 pip 误下载 2.6GB 的 torch 来降级。

### 4. 安装 YOLO（ultralytics）

```bash
python -s -m pip install "numpy==1.26.4" "opencv-python==4.10.0.84" "ultralytics>=8.0,<8.4"
```

- `<8.4` 才兼容 torch 2.0.x；最新版 ultralytics 会要求新版 torch/torchvision，反向把 cu118 顶掉。
- **必须钉住 `numpy==1.26.4` 和 `opencv-python` 4.x**：裸装 ultralytics 会拉 numpy 2.x + opencv-python 5.x，而 torch 2.0.1 与 numpy 2 不兼容——`torch.from_numpy` 会直接报 `RuntimeError: Numpy is not available`。

### 5. 验证

```bash
python -c "import torch; print(torch.__version__, torch.cuda.is_available())"      # 期望 2.0.1+cu118 True
python -c "import torchvision; print(torchvision.__version__)"                      # 期望 0.15.2+cu118
python -c "import ultralytics; print(ultralytics.__version__)"
```

### 注意事项

- **`-s` 参数必须带**：本机用户 site（`C:\Users\aaron\AppData\Roaming\Python\Python310\site-packages`）在 sys.path 中排在环境之前，裸 `pip install` 会把包装进用户目录而非当前环境，导致导入到错误版本（如 torchvision 装成 `+cpu`）。`python -s -m pip install` 禁用用户 site，强制装进当前环境。
- **控制台编码**：运行后端/训练脚本时先设 `set PYTHONIOENCODING=utf-8`（cmd/PowerShell），**不要用 `-X utf8`**（会把 GBK 编码的 easy-install.pth 搞炸）。
- **运行 v5 后端**：在 cscan_env 下 `cd backend && python -m uvicorn main:app --reload --port 8000`（前端固定请求 8000 端口）。

### CScan 训练（cscan_v1）

C扫项目副本在 `test/cscan_v1`（`yolov8.py` + `YOLO_Dataset`，400 训练/172 验证图，8 类缺陷）。训练前先确认 `yolov8.py` 的 `DATASET_YAML` 与 `YOLO_Dataset/dataset.yaml` 的 `train/val` 路径指向本副本：

```bash
cd F:\Learn\learn_torch\test\cscan_v1
python -s yolov8.py   # 训练 100 epochs，产出 YOLOv8_Defect_Multiclass/defect_multiclass_train/weights/best.pt
```


## git
git status
git add .
git commit -m "xxx"
git log --oneline


## TODO
train.py中深度学习模型未考虑元数据
signal_analysis.py中detect_surface_and_backwall，底波找的不对，界波之后 15%~97% 区间内的最大波峰对薄板不合适；信噪比估算中假设后200个点不合适
