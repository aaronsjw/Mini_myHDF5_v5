// 数据集树配置（与左侧"数据库"菜单分组一致）
// 供训练/测试面板的树状数据集下拉使用。
export const RUNNABLE_ASCAN = 'ultrasonic/ascan'  // 唯一可在 web 跑 RF/DL 训练/测试的数据集
export const CSCAN_DATASET = 'ultrasonic/cscan'

// 叶子: { value, label, kind: 'ascan'|'cscan'|null, runnable, tip }
export const DATASET_CATEGORIES = [
    {
        label: '超声检测',
        children: [
            { value: RUNNABLE_ASCAN, label: '超声 AScan（.nde 信号）', kind: 'ascan', runnable: true, tip: 'RF/DL 信号分类' },
            { value: CSCAN_DATASET, label: '超声 CScan（图像检测）', kind: 'cscan', runnable: true, tip: 'YOLO 检测 · web 训练/评估已接入' },
            { value: 'ultrasonic/paut', label: '超声相控阵 PAUT', runnable: false, tip: '待开发' },
            { value: 'ultrasonic/guidedwave', label: '导波 GW', runnable: false, tip: '待开发' },
            { value: 'ultrasonic/ae', label: '声发射 AE', runnable: false, tip: '待开发' },
        ],
    },
    {
        label: '射线检测',
        children: [
            { value: 'radiography/dr', label: '数字射线 DR', runnable: false, tip: '待开发' },
            { value: 'radiography/ict', label: '工业 CT', runnable: false, tip: '待开发' },
            { value: 'radiography/terahertz', label: '太赫兹', runnable: false, tip: '待开发' },
        ],
    },
    {
        label: '光学检测',
        children: [
            { value: 'optical/vt', label: '内窥镜 VT', runnable: false, tip: '待开发' },
            { value: 'optical/irt', label: '红外热成像 IRT', runnable: false, tip: '待开发' },
            { value: 'optical/shearography', label: '激光剪切散斑', runnable: false, tip: '待开发' },
        ],
    },
    {
        label: '电磁检测',
        children: [
            { value: 'electromagnetic/et', label: '涡流 ET', runnable: false, tip: '待开发' },
        ],
    },
]

// 展平查找工具
export const findDataset = (value) => {
    for (const cat of DATASET_CATEGORIES) {
        const hit = cat.children.find(c => c.value === value)
        if (hit) return hit
    }
    return null
}

export const toGroupedOptions = () =>
    DATASET_CATEGORIES.map(cat => ({
        label: cat.label,
        options: cat.children.map(c => ({
            value: c.value,
            label: c.runnable ? c.label : `${c.label}（${c.tip}）`,
            disabled: !c.runnable,
        })),
    }))
