# NDE 文件命名规则

命名格式：`{纤维类型}_{基体类型}_{结构}_{检测方法}_{缺陷类型}_{型号}_{时间戳}.nde`

---

## 纤维类型

| 缩写 | 含义 |
|------|------|
| CF | 碳纤维 |
| GF | 玻璃纤维，石英纤维 |
| BF | 硼纤维 Boron |
| AF | 芳纶纤维 Aramid |
| C/SiC | 碳/碳化硅 |

## 基体类型

| 缩写 | 含义 |
|------|------|
| EP | 环氧 Epoxy |
| BMI | 双马 BMI |
| PI | 聚酰亚胺 Polyimide |
| TP | 热塑 Thermoplastic（PEEK PPS） |
| SiC | 碳化硅 |

## 结构

| 缩写 | 含义 |
|------|------|
| Plate | 平板（RTM、RFI） |
| Taper | 变厚度平板 |
| RZone | R区 |
| BondPP | 板板胶接 Plate-Plate bonding |
| BondSC | 板芯胶接 Skin-Core bonding |
| Hybrid | 混杂铺层 |

## 检测方法

| 缩写 | 含义 |
|------|------|
| WRUT | 水耦合反射水膜/水浸单探头 Water |
| WPUT | 水穿透 |
| DBUT | 延迟块耦合单探头 Delay block |
| PAUT | 相控阵 |
| AUT | 空耦 AirUT |
| LUT | 激光 LaserUT |

## 缺陷类型

| 缩写 | 含义 |
|------|------|
| OK | 好区 |
| Dl | 分层 Delamination |
| Db | 脱粘 Debonding |
| Po | 孔隙 Porosity |
| Vo | 气孔 Void |
| In | 夹杂 Inclusion |
| Fb | 纤维相关 Fiber-related（纤维屈曲、纤维褶皱） |
| Rs | 树脂相关 Resin-related（富脂、贫胶） |
| Cp | 耦合不良 Coupling-related（探头耦合不充分、水膜异常等） |
| Uc | 不可识别 Unclassified |


## 逐帧标注说明

| 符号 | 含义 | 说明 |
|------|------|------|
| · 或 N | Normal | 正常超声 A 扫波形，是检测的起始和基准，所有模型都必须首先能准确识别它 |
| [ | 噪音起始点 | |
| ] | 噪音中止点 | |
| DL | Delamination | 分层。最常见且最重要的缺陷波形，FIB 形态与正常波形差异显著，是检测模型必须识别的核心缺陷类型 |
| DB | Debonding | 脱粘 |
| P | Porosity | 孔隙 |
| V | Voids | 气孔 |
| I | Inclusion | 夹杂 |
| F | Fiber-related | 纤维相关 |
| RR | Resin-Rich Area | 富树脂 |
| RS | Resin-Starved Area | 贫胶 |
| T | Transition | 波形过渡、信号转换 |
| U | Unclassifiable | 不可分类 |
| ~ | Signal quality change | 信号质量发生变化 |