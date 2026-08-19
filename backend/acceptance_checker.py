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
        if violations:
            fatal = [v for v in violations if v["action"] == "不合格"]
            warnings = [v for v in violations if v["action"] != "不合格"]
            if fatal:
                # 信号层面已足以判定不合格（如底波消失=脱粘），无需尺寸
                passed = False
                reason = "不合格：" + "；".join([v["description"] for v in fatal])
                if warnings:
                    reason += f"。另有警告：{'；'.join([v['description'] for v in warnings])}"
            elif needs_cscan:
                # 只触发"可疑"级，且该缺陷的合格判定依赖尺寸（AScan 给不出尺寸）→ 无法判定
                passed = None
                reason = "无法判定，需补充尺寸信息：" + "；".join([v["description"] for v in warnings])
            else:
                passed = True
                reason = "合格，但有需要注意的事项：" + "；".join([v["description"] for v in violations])
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
