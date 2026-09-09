"""
验收判定规则引擎

工作流程：
1. 加载 standards/index.json 获取可用的验收标准列表
2. 按标准 ID 加载对应的 summary.json
3. 将信号分析/模型预测结果与验收条款逐条匹配
4. 输出判定结果（合格/不合格/需要补充检测）

规则语法：
- 简单比较: field operator value (如 amp_attenuation >= 50)
- 逻辑组合: condition1 and condition2 (如 backwall_ratio < 0.2 and snr_db < 10)
"""

import json
import os
import re
from typing import Optional

# CScan 机器阈值字段：中文名与单位（仅用于 reason 文案）
_CSCAN_FIELD_ZH = {
    "cscan_z_value": "缺陷投影尺寸 Z=(X+Y)/2",
    "cscan_area_pct": "缺陷面积占比",
    "cscan_max_dim_mm": "最大缺陷尺寸",
    "cscan_edge_gap_min_mm": "相邻缺陷最小间距",
    "cscan_count": "检出缺陷数",
}
_CSCAN_UNIT = {
    "cscan_z_value": "mm", "cscan_max_dim_mm": "mm",
    "cscan_edge_gap_min_mm": "mm", "cscan_area_pct": "%", "cscan_count": "",
}

# 验收判定类
class AcceptanceChecker:
    def __init__(self, standards_dir: str = None):
        self.standards_dir = standards_dir or os.path.join(
            os.path.dirname(__file__), "..", "standards"
        )
        self._index = None
        self._loaded_standards = {}

    # 索引管理
    def get_index(self) -> list:
        """返回所有可用的验收标准列表"""
        if self._index is None:
            self._index = self._load_index()
        return self._index

    def _load_index(self) -> list:
        path = os.path.join(self.standards_dir, "index.json")
        if not os.path.exists(path):
            return []
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            return data.get("standards", [])
        except Exception:
            return []

    # 标准加载
    def load_standard(self, standard_id: str) -> Optional[dict]:
        """按标准 ID 加载对应的 summary.json"""
        if standard_id in self._loaded_standards:
            return self._loaded_standards[standard_id]

        # 从索引中查找所属类别
        index_entry = None
        for s in self.get_index():
            if s["id"] == standard_id:
                index_entry = s
                break

        if not index_entry:
            return None

        category = index_entry.get("category", "")
        summary_path = os.path.join(self.standards_dir, category, "summary.json")
        if not os.path.exists(summary_path):
            return None

        try:
            with open(summary_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            self._loaded_standards[standard_id] = data
            return data
        except Exception:
            return None

    # 缺陷评估判定
    def check(self, standard_id: str, detection_result: dict) -> dict:
        """
        根据验收标准检查缺陷是否超标

        detection_result 格式:
        {
            "defect_type": "分层",          # 检测到的缺陷类型
            "defect_type_en": "Dl",         # 英文缩写
            "confidence": 0.85,             # 置信度
            "signal_features": {            # 信号特征
                "amp_range": [-1800, 1900],
                "amp_attenuation": 55,      # 幅值衰减百分比
                "energy": 250000,
                "snr_db": 8.5,
                "backwall_ratio": 0.25,
                "peak_location": 180,
                "mean_amplitude": 120,
                "std_amplitude": 350,
                "abnormal_zone_desc": "帧 3-6 幅值异常",
                "consecutive_abnormal": 4,  # 连续异常帧数
                "peak_shift": 15,
                "waveform_corr": 0.55,
                "porosity_estimate": 1.5,
                "detected_frames": 64,
                "abnormal_frames": [3, 4, 5, 6]
            },
            "prediction": {
                "prediction": "Dl",
                "confidence": 0.85,
                "top3": ["Dl", "Db", "Po"]
            }
        }

        返回格式:
        {
            "standard_id": "HBxxxx-2022",
            "standard_name": "...",
            "defect_type": "分层",
            "passed": False,           # True=合格, False=不合格, None=无法判定
            "reason": "...",           # 判定理由
            "violations": [...],       # 违规条款
            "suggestions": [...],      # 建议补充的检测方法
            "needs_cscan": False       # 是否需要 C-scan
        }
        """
        standard = self.load_standard(standard_id)
        if not standard:
            return {
                "standard_id": standard_id,
                "error": f"未找到验收标准: {standard_id}",
                "passed": None,
                "violations": [],
                "suggestions": []
            }

        defect_type = detection_result.get("defect_type", "")
        defect_type_en = detection_result.get("defect_type_en", "")
        features = detection_result.get("signal_features", {})
        # 质量控制等级: 请求显式 grade 优先, 否则取标准默认 (HB 默认 C)
        grade = detection_result.get("grade") or standard.get("default_grade") or "C"
        cscan_evaluated = False

        # 查找匹配缺陷类型的条款
        criteria = self._find_criteria(standard, defect_type, defect_type_en)
        if not criteria:
            return {
                "standard_id": standard_id,
                "standard_name": standard.get("name", ""),
                "defect_type": defect_type,
                "passed": None,
                "reason": f"验收标准中未找到与「{defect_type}」相关的条款",
                "violations": [],
                "suggestions": []
            }

        # 逐条匹配条件
        violations = []
        for cond in criteria.get("conditions", []):
            rule = cond.get("rule", "")
            matched, detail = self._eval_rule(rule, features)
            if matched:
                violations.append({
                    "level": cond.get("level", ""),
                    "description": cond.get("description", ""),
                    "detail": detail,
                    "action": cond.get("action", "不合格"),
                })

        # 判断是否超标：按 action 定级 + 是否需要 CScan 尺寸
        needs_cscan = criteria.get("needs_cscan", False)
        fatal = [v for v in violations if v["action"] == "不合格"]
        warnings = [v for v in violations if v["action"] != "不合格"]
        # CScan 能否做尺寸判定取决于该缺陷的主判据字段（cscan_thresholds.grade_field）是否给出。
        # area_pct 可由像素直算(无需 mm/px，孔隙/富树脂用它)；但 Z/最大尺寸等 mm 量必须给比例尺。
        cs_thr = criteria.get("cscan_thresholds") or {}
        cs_primary = cs_thr.get("grade_field")
        cscan_evaluable = bool(cs_primary) and features.get(cs_primary) is not None
        # CScan 已检出缺陷(cscan_count>0) 但缺主判据(如给不出 mm) → 无法换算物理尺寸
        cscan_unsized = not cscan_evaluable and int(features.get("cscan_count", 0) or 0) > 0

        if fatal:
            # 信号层面已足以判定不合格（如底波消失=脱粘），无需尺寸
            passed = False
            reason = "不合格：" + "；".join([v["description"] for v in fatal])
            if warnings:
                reason += f"。另有警告：{'；'.join([v['description'] for v in warnings])}"
        elif needs_cscan and cscan_evaluable:
            # needs_cscan 缺陷且主判据已给 → 机器阈值判定（与 AScan 是否有可疑无关）
            cs = self._eval_cscan(criteria, features, grade)
            cs_fatal = [v for v in cs if v["action"] == "不合格"]
            cs_warn = [v for v in cs if v["action"] != "不合格"]
            violations = violations + cs
            cscan_evaluated = True
            if cs_fatal:
                passed = False
                reason = "不合格（CScan 尺寸判定）：" + "；".join(v["description"] for v in cs_fatal)
                if cs_warn:
                    reason += f"。另：{'；'.join(v['description'] for v in cs_warn)}"
            elif cs_warn:
                passed = True
                reason = "合格（CScan 尺寸判定），但 " + "；".join(v["description"] for v in cs_warn)
            else:
                passed = True
                reason = f"合格（CScan 尺寸判定），尺寸/面积均未超 {grade} 级限值"
                if warnings:
                    reason += "。AScan 另有提示：" + "；".join([v["description"] for v in warnings])
        elif needs_cscan and (warnings or cscan_unsized):
            # needs_cscan 但缺尺寸特征 -> 无法判定：
            #   - 纯 AScan 可疑(无 CScan) 维持原文案；CScan 检出缺陷但没给 mm/px 则追加说明
            passed = None
            if warnings:
                reason = "无法判定，需补充尺寸信息：" + "；".join(v["description"] for v in warnings)
                if cscan_unsized:
                    reason += (f"。CScan 检出 {int(features.get('cscan_count', 0))} 处缺陷，"
                               "但未提供 mm/px 比例尺，无法换算物理尺寸")
            else:
                reason = (f"无法判定：CScan 检出 {int(features.get('cscan_count', 0))} 处缺陷，"
                          "但未提供 mm/px 比例尺，无法换算物理尺寸")
        else:
            passed = True
            reason = "合格，未触发任何验收条款"

        # 补充检测建议
        suggestions = []
        if needs_cscan:
            suggestions.append("单纯从超声 AScan 无法获得缺陷尺寸信息，建议补充超声 CScan")

        comp_methods = standard.get("complementary_methods", {})
        def_type_key = defect_type or defect_type_en
        if def_type_key in comp_methods:
            for method in comp_methods[def_type_key]:
                if method not in suggestions:
                    suggestions.append(f"建议{method}辅助验证")

        return {
            "standard_id": standard_id,
            "standard_name": standard.get("name", ""),
            "defect_type": defect_type,
            "passed": passed,
            "reason": reason,
            "violations": violations,
            "suggestions": suggestions,
            "needs_cscan": needs_cscan,
            "cscan_criteria": criteria.get("cscan_criteria", None),
            "cscan_grade": grade,
            "cscan_evaluated": cscan_evaluated,
        }

    # 辅助方法
    def _find_criteria(self, standard: dict, defect_type: str, defect_type_en: str) -> Optional[dict]:
        """在标准中查找匹配缺陷类型的验收条款"""
        for c in standard.get("defect_criteria", []):
            if c.get("defect_type") == defect_type:
                return c
            if defect_type_en and defect_type_en in c.get("defect_type_alias", []):
                return c
        return None

    # 规则索引
    def _eval_rule(self, rule: str, features: dict) -> tuple:
        """
        评估单条规则
        返回 (matched: bool, detail: str)

        支持语法:
        - amp_attenuation >= 50
        - consecutive_abnormal >= 3
        - backwall_ratio < 0.1
        - backwall_ratio < 0.2 and snr_db < 10
        - porosity_estimate > 2
        """
        if not rule or not features:
            return False, ""

        # 处理 and 组合（全部满足才匹配）
        if " and " in rule:
            parts = [p.strip() for p in rule.split(" and ")]
            all_details = []
            for part in parts:
                matched, detail = self._eval_single_rule(part, features)
                all_details.append(detail)
                if not matched:
                    return False, " && ".join(all_details)
            return True, " && ".join(all_details)

        # 处理 or 组合（任一满足即匹配）
        if " or " in rule:
            parts = [p.strip() for p in rule.split(" or ")]
            all_details = []
            for part in parts:
                matched, detail = self._eval_single_rule(part, features)
                all_details.append(detail)
                if matched:
                    return True, " || ".join(all_details)
            return False, " || ".join(all_details)

        return self._eval_single_rule(rule, features)

    #
    def _eval_single_rule(self, rule: str, features: dict) -> tuple:
        """评估单个条件"""
        pattern = r"^([a-zA-Z_0-9]+)\s*(>=|<=|>|<|==|!=)\s*(-?[\d.]+)$"
        m = re.match(pattern, rule.strip())
        if not m:
            return False, f"无法解析规则: {rule}"

        field, op, val_str = m.groups()
        val = float(val_str)

        if field not in features:
            return False, f"{field}=N/A"

        actual = features[field]
        try:
            actual_float = float(actual)
        except (TypeError, ValueError):
            return False, f"{field}={actual}"

        detail = f"{field}={actual_float} {op} {val}"

        if op == ">=":
            return actual_float >= val, detail
        elif op == "<=":
            return actual_float <= val, detail
        elif op == ">":
            return actual_float > val, detail
        elif op == "<":
            return actual_float < val, detail
        elif op == "==":
            return actual_float == val, detail
        elif op == "!=":
            return actual_float != val, detail
        return False, detail

    # CScan 尺寸/面积机器阈值判定
    def _eval_cscan(self, criteria: dict, features: dict, grade: str) -> list:
        """按 cscan_thresholds 机器阈值判定 CScan 尺寸/面积是否超限。

        返回 violations 列表：
        - 尺寸(Z)/面积超对应等级限值 -> action = 不合格
        - 相邻缺陷边缘间距 < edge_min   -> action = 警告（应合并计算，不直接判不合格）
        """
        thr = criteria.get("cscan_thresholds")
        if not thr:
            return []
        op = thr.get("compare", ">")
        action = thr.get("action", "不合格")
        out = []

        # 单/双判据: grade_field (Z 表) + grade_field2 (面积表)
        for field, gv_key in ((thr.get("grade_field"), "grade_values"),
                              (thr.get("grade_field2"), "grade_values2")):
            if not field or field not in features:
                continue
            val = features[field]
            if val is None:
                continue
            limit = (thr.get(gv_key) or {}).get(grade)
            if limit is None:
                continue
            exceeded = float(val) > float(limit) if op == ">" else float(val) < float(limit)
            if exceeded:
                zh = _CSCAN_FIELD_ZH.get(field, field)
                unit = _CSCAN_UNIT.get(field, "")
                out.append({
                    "level": f"{grade} 级",
                    "description": f"CScan {zh}={val:.2f}{unit} 超 {grade} 级限值 {limit}{unit}",
                    "detail": f"{field}={val} {op} {limit}",
                    "action": action,
                    "source": "cscan",
                })

        # 相邻缺陷间距不足 -> 应合并计算的警告
        edge_field = thr.get("edge_field")
        edge_min = thr.get("edge_min")
        if edge_field and edge_field in features:
            gap = features[edge_field]
            if gap is not None and float(gap) < float(edge_min):
                zh = _CSCAN_FIELD_ZH.get(edge_field, edge_field)
                out.append({
                    "level": "警告",
                    "description": f"CScan {zh}={gap:.2f}mm < {edge_min}mm，按标准应合并计算",
                    "detail": f"{edge_field}={gap} < {edge_min}",
                    "action": "警告",
                    "source": "cscan",
                })
        return out

    # 自动匹配标准
    def suggest_standard(self, meta: dict) -> Optional[str]:
        """根据材料信息自动推荐适用的验收标准"""
        fiber = (meta.get("fiber") or "").upper()
        matrix = (meta.get("matrix") or "").upper()

        for s in self.get_index():
            materials = [m.upper() for m in s.get("applicable_materials", [])]
            for mat in materials:
                parts = mat.split("/")
                if len(parts) == 2:
                    if parts[0] in fiber and parts[1] in matrix:
                        return s["id"]
        # 如果没匹配到精确的，返回第一个标准
        standards = self.get_index()
        return standards[0]["id"] if standards else None
