# SCI 论文思路 — 复合材料超声智能检测与评估系统

## 一、项目优势（论文亮点）

| 维度 | 你的项目有 | 同类论文通常没有 |
|------|-----------|----------------|
| 数据标注系统 | 逐帧交互标注 + 键盘快捷键 + 一键标注 | 多数论文直接用完整标签数据集，不涉及标注过程 |
| 信号 + ML + LLM 三板斧 | 传统信号分析 + 模型预测 + DeepSeek 对话解释 | 要么纯信号处理，要么纯深度学习 |
| Web 可视化 | 实时 A-scan / B-scan 交互浏览 | 多为离线 Python 脚本 |
| 实际数据 | dataset/ 目录下的真实 .nde 文件 | 很多论文只用在标准数据集或仿真数据 |

## 二、可选论文方向

### 方向一（推荐）：Interactive Labeling + Semi-supervised Learning

**核心贡献**：人机协同逐帧标注系统，用少量标注 + 信号特征 + 半监督学习实现高精度缺陷识别。

**核心叙事**：
超声检测数据标注成本高（需专家逐帧判断），开发交互式标注平台，结合快捷键和自动标注建议，提升标注效率 X%。基于标注结果，用半监督学习（少量标注 + 大量未标注数据）训练缺陷分类模型。

**需补充工作**：
- 标注效率对比实验（纯手动 vs 本系统，计时统计）
- 半监督学习模块（伪标签 / 一致性正则化）
- 标注一致性分析（Cohen's Kappa / F1-score）

**目标期刊**：

| 期刊 | 级别 | 匹配度 |
|------|------|--------|
| NDT & E International | SCI 一区/二区 | ⭐⭐⭐⭐⭐ 最对口 |
| Ultrasonics | SCI 二区 | ⭐⭐⭐⭐ |
| Composite Structures | SCI 一区/二区 | ⭐⭐⭐（强调复合材料方向） |
| Mechanical Systems and Signal Processing | SCI 一区 | ⭐⭐⭐（需强化信号处理） |

### 方向二：Multi-modal Explainable AI Framework

**核心贡献**：信号特征提取 + ML 分类 + LLM 解释的三级管道，实现可解释的超声缺陷诊断。

**核心叙事**：
现有方法要么是"黑箱"深度学习（不解释），要么依赖专家经验。本文提出三级框架：
1. 自动提取工程信号特征（能量、SNR、底波比等）
2. 传统 ML（RF）做高置信度分类
3. LLM（DeepSeek）生成自然语言诊断报告，解释信号特征与缺陷的关联

**亮点**：
- 可解释性：不是"模型说这是分层"，而是"信号底波能量比下降 40%，与分层模式吻合"
- 置信度分级：高置信度 ML 直接出结果，低置信度转 LLM 人工分析
- 目前论文中很少见的组合

**需补充工作**：
- 消融实验（纯信号阈值 vs 纯 RF vs 纯 DL vs 三级管道）
- 可解释性评估（专家评分表）
- 200+ .nde 文件的统计分析

**目标期刊**：

| 期刊 | 级别 | 匹配度 |
|------|------|--------|
| Expert Systems with Applications | SCI 一区 | ⭐⭐⭐⭐⭐ |
| Mechanical Systems and Signal Processing | SCI 一区 | ⭐⭐⭐⭐ |
| IEEE Trans. Instrumentation and Measurement | SCI 二区 | ⭐⭐⭐⭐ |
| Knowledge-Based Systems | SCI 一区 | ⭐⭐⭐ |

### 方向三：NDE 4.0 — Web-based Intelligent Platform

**核心贡献**：符合 NDE 4.0 概念的开放式智能检测平台架构。

**核心叙事**：
工业 4.0 背景下，NDE 4.0 倡导数据互通与智能分析。开发基于 Web 的开源平台，支持 .nde 开放格式全流程：数据浏览 → 逐帧标注 → 模型训练 → 智能评估。集成 LLM 实现人机自然语言交互式诊断。

**需补充工作**：
- 系统架构图（技术架构 + 数据流）
- 性能基准测试（渲染性能、API 响应时间）
- 案例研究（完整展示上传 → 标注 → 训练 → 评估）
- 与商业软件功能对比表

**目标期刊**：

| 期刊 | 级别 | 匹配度 |
|------|------|--------|
| SoftwareX | SCI 二区 | ⭐⭐⭐⭐⭐ 软件工具类最合适 |
| Journal of Nondestructive Evaluation | SCI 三区 | ⭐⭐⭐⭐ |
| Sensors (MDPI) | SCI 三区 | ⭐⭐⭐ |

## 三、论文框架示例（以方向二为例）

**Title**: A Multi-modal Explainable AI Framework for Ultrasonic Nondestructive Evaluation of Composite Materials

1. **Introduction**
   - 复合材料超声检测的重要性
   - 现有方法局限（黑箱模型、缺乏可解释性）
   - 本文贡献

2. **Related Work**
   - 超声 NDE 信号处理
   - 深度学习缺陷分类
   - LLM 在工业中的应用

3. **Methodology**（核心）
   - 3.1 Signal Feature Extraction（能量、SNR、底波比、异常区域）
   - 3.2 Machine Learning Classification（RF vs DeepNDE）
   - 3.3 LLM-based Explainable Diagnosis（DeepSeek + prompt engineering）
   - 3.4 Web-Based Interactive Interface

4. **Experiments**
   - 4.1 Dataset Description（数据统计与分布）
   - 4.2 Ablation Study（各模块独立 vs 组合效果）
   - 4.3 Explainability Evaluation（专家评分）
   - 4.4 System Performance（响应时间、资源占用）

5. **Discussion**
   - 局限性、泛化性、未来方向

6. **Conclusion**

## 四、建议准备的工作清单

| 事项 | 难度 | 估计时间 |
|------|------|---------|
| 整理 dataset/ 数据，统计缺陷分布 | ⭐ | 1 天 |
| 跑分类实验（RF + DeepNDE 对比） | ⭐⭐ | 2 天 |
| 标注效率对比实验 | ⭐⭐ | 2 天 |
| 消融实验 | ⭐⭐⭐ | 3 天 |
| LLM 可解释性评估（找专家评分） | ⭐⭐⭐ | 1 周 |
| 写论文 | ⭐⭐⭐⭐ | 1-2 周 |

**最低起步建议**：
1. 先统计 dataset/ 下有多少个 .nde 文件、各类缺陷分布
2. 用现有 trainer.py 跑一组完整的分类实验，记录准确率/精确率/召回率
3. 确定数据量再看哪个方向最可行
