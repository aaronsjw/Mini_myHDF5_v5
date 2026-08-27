
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
├── dataset/                              # 超声检测数据集 (.nde 格式)
│   ├── Cp/                               # 气孔缺陷
│   ├── Db/                               # 脱粘缺陷
│   ├── Dl/                               # 分层缺陷
│   ├── Fb/                               # 外来物
│   ├── In/                               # 夹杂
│   ├── OK/                               # 无缺陷
│   ├── Po/                               # 孔隙
│   ├── Rs/                               # 树脂
│   ├── Vo/                               # 空洞
│   └── TODO/                             # 待标注数据
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


## git
git status
git add .
git commit -m "xxx"
git log --oneline


## TODO
train.py中深度学习模型未考虑元数据
signal_analysis.py中detect_surface_and_backwall，底波找的不对，界波之后 15%~97% 区间内的最大波峰对薄板不合适；信噪比估算中假设后200个点不合适
