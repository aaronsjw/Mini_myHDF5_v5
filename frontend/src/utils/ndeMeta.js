// .nde 文件名元数据解析与中文描述生成
// 文件名格式: {纤维}_{基体}_{结构}_{方法}_{缺陷}_{型号}_{时间戳}_{纤维牌号}_{基体牌号}.nde
// 例: GFAF_EP_BondPP_WRUT_Db_Z109_20260820140045_FQW199_5224A.nde

const STRUCTURE_LABELS = {
    Plate: '平板',
    Taper: '变厚度平板',
    RZone: 'R区',
    BondPP: '板板胶接',
    BondSC: '板芯胶接',
    Hybrid: '混杂铺层',
}

const FIBER_LABELS = {
    CF: '碳纤维',
    GF: '玻璃纤维',
    GFAF: '玻纤/芳纶混杂',
    BF: '硼纤维',
    AF: '芳纶纤维',
    'C/SiC': '碳/碳化硅',
}

const MATRIX_LABELS = {
    EP: '环氧树脂',
    BMI: '双马来酰亚胺树脂',
    PI: '聚酰亚胺',
    TP: '热塑性树脂',
    SiC: '碳化硅',
}

const METHOD_LABELS = {
    WRUT: '水耦合反射/水浸',
    WPUT: '水穿透',
    DBUT: '延迟块耦合',
    PAUT: '相控阵',
    AUT: '空耦',
    LUT: '激光',
}

const DEFECT_LABELS = {
    OK: '无缺陷',
    Dl: '分层',
    Db: '脱粘',
    Po: '孔隙',
    Ap: '胶膜孔隙',
    Vo: '气孔',
    In: '夹杂',
    Fb: '纤维相关',
    Rs: '树脂相关',
    Cp: '耦合不良',
    Uc: '不可识别',
}

/** 解析 .nde 文件名，返回各段元数据；空/非法名返回 null */
export function parseNdeFilename(filename = '') {
    if (!filename) return null
    const p = String(filename).replace(/\.nde$/i, '').split('_')
    if (p.length < 5) return null
    const [fiber, matrix, structure, method, defect, model, ts, fiberGrade, matrixGrade] = p
    return {
        fiber: fiber || '-',
        matrix: matrix || '-',
        structure: structure || '-',
        method: method || '-',
        defect: defect || '-',
        model: model || '-',
        ts: ts || '-',
        fiberGrade: fiberGrade || '-',
        matrixGrade: matrixGrade || '-',
    }
}

/** 结构缩写 → 中文；未知兜底 '平板' */
export const structureLabel = s => STRUCTURE_LABELS[s] || '平板'

const orRaw = (map, code) => (map && map[code]) || (code && code !== '-' ? code : '—')

/** 根据元数据生成中文描述段落 */
export function buildStructureDescription(meta) {
    if (!meta || !meta.structure || meta.structure === '-') {
        return '当前文件未解析到结构信息，以下为通用平板示意（结构参数可在文件名中按「纤维_树脂_结构_方法_缺陷_型号_时间_纤维牌号_树脂牌号」顺序解析）。'
    }
    const s = STRUCTURE_LABELS[meta.structure] || '平板'
    const head =
        meta.structure === 'BondSC'
            ? `该试件为「${s}（${meta.structure}）」结构，由上下两层复合材料板与中间蜂窝芯构成。`
            : meta.structure === 'BondPP'
                ? `该试件为「${s}（${meta.structure}）」结构，由上下两层板材与中间胶接层构成。`
                : meta.structure === 'Taper'
                    ? `该试件为「${s}（${meta.structure}）」结构，板厚沿扫描方向呈楔形渐变。`
                    : `该试件为「${s}（${meta.structure}）」结构。`
    const fiber = orRaw(FIBER_LABELS, meta.fiber)
    const matrix = orRaw(MATRIX_LABELS, meta.matrix)
    return [
        head,
        `材料体系：${fiber} 增强 ${matrix}；纤维牌号 ${orRaw({}, meta.fiberGrade)}，树脂牌号 ${orRaw({}, meta.matrixGrade)}。`,
        `检测方式：${orRaw(METHOD_LABELS, meta.method)}（型号 ${orRaw({}, meta.model)}）。`,
        meta.defect && meta.defect !== 'OK'
            ? `内置缺陷：${orRaw(DEFECT_LABELS, meta.defect)}（${meta.defect}）。`
            : '内置缺陷：无（OK）。',
    ].join('\n')
}
