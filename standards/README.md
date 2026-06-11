# 验收标准文件目录

本目录存放各类验收标准文件，用于零件缺陷检测结果的验收判定。

## 目录结构

```
standards/
├── index.json         ← 所有验收文件索引
├── GJB/               ← 国军标
├── HB/                ← 航空行业标准（含示例）
└── internal/           ← 内部验收规范
```

## 如何添加新的验收标准

1. 将验收文件（PDF/DOCX）放入对应的子目录
2. 编辑 `index.json`，在 `standards` 数组中添加新条目
3. 在子目录中创建 `summary.json`，结构化描述验收条款

## summary.json 格式说明

见 `HB/summary.json` 示例。
