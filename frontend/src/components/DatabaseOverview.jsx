import React, { useState, useEffect, useRef } from 'react'
import { Card, Table, Tag, Statistic, Row, Col, Spin, Tooltip, Input, Select, Button, Space, Modal, message, Pagination } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import axios from 'axios'

// 命名规则中 缺陷类型 对应的中文
const DEFECT_LABELS = {
    OK: { color: 'green', text: '好区' },
    Cr: { color: 'magenta', text: '裂纹' },
    Dl: { color: 'red', text: '分层' },
    Db: { color: 'orange', text: '脱粘' },
    Po: { color: 'volcano', text: '孔隙' },
    Ap: { color: 'gold', text: '胶膜孔隙' },
    Vo: { color: 'purple', text: '气孔' },
    In: { color: 'blue', text: '夹杂' },
    Fb: { color: 'cyan', text: '纤维相关' },
    Rs: { color: 'geekblue', text: '树脂相关' },
    Cp: { color: 'magenta', text: '耦合不良' },
    Uc: { color: 'default', text: '不可识别' }
}

// 脱粘(Db)按结构细分：标签保持 Db，显示时区分（BondPP=板板脱粘, BondSC=板芯脱粘）
const DB_STRUCTURE_TEXT = {
    BondPP: '板板脱粘',
    BondSC: '板芯脱粘',
}

// 命名规则中字段的中文名
const FIELD_LABELS = {
    fiber: '纤维类型',
    matrix: '基体类型',
    structure: '结构',
    method: '检测方法',
    defect: '缺陷类型',
    model: '项目',
    timestamp: '时间戳'
}

// 编辑表单的可选值
const FIBER_OPTS = ['CF', 'GF', 'BF', 'AF']
const MATRIX_OPTS = ['EP', 'BMI', 'PI', 'TP', 'SiC']
const STRUCT_OPTS = ['Plate', 'Taper', 'BondPP', 'BondSC']
const METHOD_OPTS = ['WRUT', 'WPUT', 'PAUT', 'AUT']
const DEFECT_OPTS = Object.keys(DEFECT_LABELS).map(k => ({
    value: k, label: `${k} · ${DEFECT_LABELS[k].text}`,
}))

// 默认（CScan）编辑表单字段
const DEFAULT_EDIT_FIELDS = [
    { k: 'defectType', label: '缺陷类型', kind: 'select', opts: DEFECT_OPTS },
    { k: 'structure', label: '结构', kind: 'select', opts: STRUCT_OPTS.map(v => ({ value: v, label: v })) },
    { k: 'method', label: '方法', kind: 'select', opts: METHOD_OPTS.map(v => ({ value: v, label: v })) },
    { k: 'code', label: '项目', kind: 'input' },
    { k: 'fiber', label: '纤维', kind: 'select', opts: FIBER_OPTS.map(v => ({ value: v, label: v })) },
    { k: 'matrix', label: '基体', kind: 'select', opts: MATRIX_OPTS.map(v => ({ value: v, label: v })) },
    { k: 'fiberGrade', label: '纤维牌号', kind: 'input' },
    { k: 'matrixGrade', label: '基体牌号', kind: 'input' },
    { k: 'probe_type', label: '探头', kind: 'input' },
    { k: 'timestamp', label: '时间戳(14位)', kind: 'input' },
]
const DEFAULT_EDIT_MAP = {
    fromMeta: m => ({
        fiber: m.fiber || '', matrix: m.matrix || '',
        structure: m.structure || '', method: m.method || '',
        defectType: m.defectType || '', code: m.code || '',
        fiberGrade: m.fiberGrade || '', matrixGrade: m.matrixGrade || '',
        probe_type: m.probe_type || '', description: m.description || '',
        timestamp: m.timestamp || '',
    }),
    toMeta: v => v,
}

// 可拖拽调整列宽的表头单元格（antd 推荐方案；此处自实现，无需 react-resizable）
function ResizableTitle({ onResize, width, children, ...rest }) {
    if (!width || !onResize) return <th {...rest}>{children}</th>
    return (
        <th {...rest} style={{ ...(rest.style || {}), position: 'relative' }}>
            {children}
            <span
                style={{
                    position: 'absolute', right: 0, top: 0, bottom: 0, width: 8,
                    cursor: 'col-resize', userSelect: 'none', touchAction: 'none', zIndex: 2,
                }}
                onMouseDown={e => {
                    e.preventDefault(); e.stopPropagation()
                    const startX = e.clientX, startW = width
                    const onMove = ev => onResize(Math.max(56, Math.round(startW + ev.clientX - startX)))
                    const onUp = () => {
                        window.removeEventListener('mousemove', onMove)
                        window.removeEventListener('mouseup', onUp)
                    }
                    window.addEventListener('mousemove', onMove)
                    window.addEventListener('mouseup', onUp)
                }}
            />
        </th>
    )
}

export default function DatabaseOverview({
    endpoint = 'http://127.0.0.1:8000/dataset_overview',
    dirLabel = 'AScan 数据目录',
    dirPath = 'dataset/ascan_dataset',
    extraColumns = [],
    imageUrlFn = null,
    mergeMaterial = false,
    manageBase = '',   // 如 'http://127.0.0.1:8000/cscan/raw'：非空时文件列表显示 编辑/删除
    thumbNode = null,  // (record) => { small, big }：自定义媒体缩略图（图片/视频）
    editSpec = null,   // { fields, fromMeta(meta)->vals, toMeta(vals)->meta }：自定义编辑表单
    deleteHint = '将移除原图/元数据/框，并删除派生切片、清理训练划分。',
    hideColumns = [],  // 需要隐藏的列 key（如 ['method']）
}) {
    const [data, setData] = useState(null)
    const [loading, setLoading] = useState(true)
    const [kw, setKw] = useState('')   // 文件列表搜索关键字（& = 且）
    const [editOpen, setEditOpen] = useState(false)
    const [editLoading, setEditLoading] = useState(false)
    const [editBusy, setEditBusy] = useState(false)
    const [editStem, setEditStem] = useState('')
    const [editVals, setEditVals] = useState({})
    const [editInit, setEditInit] = useState({})   // 打开时的初值，用于判断是否有修改
    const [tbodyH, setTbodyH] = useState(300)   // 表格体高度（自适应剩余空间）
    const [page, setPage] = useState(1)
    const [pageSize, setPageSize] = useState(5)
    const [colW, setColW] = useState({})          // 用户拖拽后的列宽覆盖 {key: px}
    const tableRef = useRef(null)               // 表格容器（用于测高）

    const refresh = () => {
        axios.get(endpoint).then(res => setData(res.data)).catch(err => console.error(err))
    }

    // 表格容器高度 → 可滚动高度（表头固定，仅表体滚动）
    useEffect(() => {
        const el = tableRef.current
        if (!el) return
        const recalc = () => setTbodyH(Math.max(160, el.clientHeight - 40))
        recalc()
        const ro = new ResizeObserver(recalc)
        ro.observe(el)
        return () => ro.disconnect()
    }, [loading])

    // 编辑表单配置（默认 CScan；其他数据集可传 editSpec 覆盖）
    const editFields = editSpec?.fields || DEFAULT_EDIT_FIELDS
    const editMap = editSpec || DEFAULT_EDIT_MAP

    // 编辑：拉边车 meta 填充表单
    const openEdit = (stem) => {
        setEditStem(stem); setEditOpen(true); setEditLoading(true); setEditVals({}); setEditInit({})
        axios.get(`${manageBase}/item`, { params: { stem } })
            .then(r => {
                const vals = editMap.fromMeta(r.data?.meta || {})
                setEditVals(vals)
                setEditInit(vals)
            })
            .catch(() => { message.error('读取该记录失败'); setEditOpen(false) })
            .finally(() => setEditLoading(false))
    }
    // 是否有修改：比较所有键（含描述等非表单字段）
    const editChanged = Object.keys({ ...editInit, ...editVals })
        .some(k => (editVals[k] ?? '') !== (editInit[k] ?? ''))

    const doEditSave = () => {
        if (!editChanged) return        // 未修改不提交
        setEditBusy(true)
        axios.put(`${manageBase}/${encodeURIComponent(editStem)}`, { meta: editMap.toMeta(editVals) })
            .then(r => {
                if (r.data?.error) { message.error(r.data.error); return }
                setEditOpen(false)
                message.success(`已更新 → ${r.data.filename || editStem}`)
                refresh()
            })
            .catch(e => message.error('更新失败: ' + (e?.response?.data?.error || e.message)))
            .finally(() => setEditBusy(false))
    }
    const doDelete = async (stem) => {
        try {
            const r = await axios.delete(`${manageBase}/${encodeURIComponent(stem)}`)
            if (r.data?.error) { message.error(r.data.error); return }
            message.success('已删除')
            refresh()
        } catch (e) {
            message.error('删除失败: ' + (e?.response?.data?.error || e.message))
        }
    }
    const askDelete = (stem, filename) => {
        Modal.confirm({
            title: '删除该条记录？',
            content: <span>{deleteHint}<br /><b>{filename}</b></span>,
            okText: '删除', okButtonProps: { danger: true }, cancelText: '取消',
            onOk: () => doDelete(stem),
        })
    }

    useEffect(() => {
        axios.get(endpoint)
            .then(res => setData(res.data))
            .catch(err => console.error(err))
            .finally(() => setLoading(false))
    }, [endpoint])

    if (loading) return <Spin size="large" style={{ display: 'block', marginTop: 100 }} />
    if (!data || data.error) return <div style={{ padding: 40, color: '#999' }}>未找到 dataset 目录</div>

    // 文件列表搜索：多个关键字用 & 连接 = 同时满足（不区分大小写，匹配任意字段）
    const tokens = (kw || '').split('&').map(s => s.trim().toLowerCase()).filter(Boolean)
    const visibleFiles = tokens.length === 0
        ? data.files
        : data.files.filter(f => tokens.every(t =>
            Object.values(f).some(v => v != null && String(v).toLowerCase().includes(t))))

    // 分组统计：复合缺陷按 & 拆开分别计数（'Dl&Po' → Dl +1、Po +1）；
    // Db 再按结构细分（BondPP=板板脱粘, BondSC=板芯脱粘）
    const groupMap = {}
    data.files.forEach(f => {
        String(f.defect || '?').split('&').map(s => s.trim()).filter(Boolean).forEach(code => {
            const sub = code === 'Db' ? (DB_STRUCTURE_TEXT[f.structure] || '脱粘') : null
            const key = sub ? `Db-${sub}` : code
            if (!groupMap[key]) groupMap[key] = { key, defect: code, sub, count: 0 }
            groupMap[key].count += 1
        })
    })
    const defectData = Object.values(groupMap)

    // 文件详情列
    const fileColumns = [
        ...(thumbNode ? [{
            title: '预览', dataIndex: 'media', key: 'image', width: 110,
            render: (_, r) => {
                const t = thumbNode(r) || {}
                if (!t.small) return '-'
                return <Tooltip title={t.big} mouseEnterDelay={0.1}><div style={{ display: 'inline-block', cursor: 'pointer' }}>{t.small}</div></Tooltip>
            },
        }] : imageUrlFn ? [{
            title: '图像', dataIndex: 'image', key: 'image', width: 90,
            render: (_, r) => {
                const url = imageUrlFn(r.filename)
                if (!url) return '-'
                return (
                    <Tooltip
                        title={
                            <img src={url} alt={r.filename}
                                 style={{ maxWidth: 600, maxHeight: 400, objectFit: 'contain', display: 'block' }} />
                        }
                        mouseEnterDelay={0.1}
                    >
                        <img src={url} alt={r.filename}
                             style={{ height: 60, objectFit: 'contain', border: '1px solid #eee', borderRadius: 4, cursor: 'zoom-in' }} />
                    </Tooltip>
                )
            }
        }] : []),
        { title: '文件名', dataIndex: 'filename', key: 'filename', width: 220, ellipsis: true },
        ...(mergeMaterial
            ? [{ title: '纤维/基体', key: 'fiberMatrix', width: 90, render: (_, r) => `${r.fiber}/${r.matrix}` }]
            : [
                { title: '纤维类型', dataIndex: 'fiber', key: 'fiber', width: 80 },
                { title: '基体类型', dataIndex: 'matrix', key: 'matrix', width: 80 },
            ]),
        { title: '结构', dataIndex: 'structure', key: 'structure', width: 88 },
        { title: '检测方法', dataIndex: 'method', key: 'method', width: 84 },
        {
            title: '缺陷类型',
            dataIndex: 'defect',
            key: 'defect',
            width: 120,
            render: (d, record) => {
                const info = DEFECT_LABELS[d] || { color: 'default', text: d }
                const text = d === 'Db' && DB_STRUCTURE_TEXT[record.structure]
                    ? `Db · ${DB_STRUCTURE_TEXT[record.structure]}`
                    : d
                return <Tag color={info.color}>{text}</Tag>
            }
        },
        { title: '项目', dataIndex: 'model', key: 'model', width: 72 },
        ...extraColumns,
        ...(manageBase ? [{
            title: '操作', key: 'ops', width: 96,
            render: (_, r) => {
                const stem = String(r.filename).replace(/\.[^.]+$/, '')
                return (
                    <Space size={4}>
                        <Button size="small" onClick={() => openEdit(stem)}
                            style={{ color: '#52c41a', borderColor: '#52c41a' }}>编辑</Button>
                        <Button size="small" danger onClick={() => askDelete(stem, r.filename)}>删除</Button>
                    </Space>
                )
            },
        }] : []),
    ].filter(c => !hideColumns.includes(c.key))

    // 应用（可拖拽的）列宽
    const sizedColumns = fileColumns.map(c => {
        const w = colW[c.key] ?? c.width ?? 100
        return {
            ...c, width: w,
            onHeaderCell: () => ({ width: w, onResize: v => setColW(prev => ({ ...prev, [c.key]: v })) }),
        }
    })
    const totalW = sizedColumns.reduce((s, c) => s + (c.width || 100), 0)

    return (
        <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* 第一行：统计卡片：总文件数，缺陷类型数，最大缺陷组，数据集目录 */}
            <Row gutter={16}>
                <Col span={6}>
                    <Card size="small">
                        <Statistic title="总文件数" value={data.total_files} />
                    </Card>
                </Col>
                <Col span={6}>
                    <Card size="small">
                        <Statistic title="缺陷类型数" value={defectData.length} />
                    </Card>
                </Col>
                <Col span={6}>
                    <Card size="small">
                        <Statistic title="最大缺陷组" value={defectData.length ? Math.max(...defectData.map(d => d.count)) : 0} />
                    </Card>
                </Col>
                <Col span={6}>
                    <Card size="small">
                        <Statistic title={dirLabel} value={dirPath} />
                    </Card>
                </Col>
            </Row>

            {/* 第二行：按缺陷类型分组（横向标签，紧凑） */}
            <Card title="按缺陷类型分组" size="small" styles={{ body: { padding: '8px 12px' } }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {defectData.map(d => {
                        const info = DEFECT_LABELS[d.defect] || { color: 'default', text: d.defect }
                        const label = d.sub ? `${d.defect} · ${d.sub}` : `${d.defect} · ${info.text}`
                        return (
                            <Tag key={d.key} color={info.color} style={{ marginRight: 0, fontSize: 13, padding: '2px 10px' }}>
                                {label}
                                <b style={{ marginLeft: 8 }}>{d.count}</b>
                            </Tag>
                        )
                    })}
                </div>
            </Card>

            {/* 第三行：文件列表（卡头/表头固定，仅表体滚动；分页在卡头右侧） */}
            <Card
                size="small"
                style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
                styles={{ body: { padding: 8, flex: 1, minHeight: 0, overflow: 'hidden' } }}
                title="文件列表"
                extra={
                    <Input
                        allowClear
                        prefix={<SearchOutlined style={{ color: '#999' }} />}
                        placeholder="搜索（& 表示且），如 T1100&Plate"
                        value={kw}
                        onChange={e => { setKw(e.target.value); setPage(1) }}
                        style={{ width: 280 }}
                    />
                }
            >
                <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                    <div ref={tableRef} style={{ flex: 1, minHeight: 0 }}>
                        <Table
                            columns={sizedColumns}
                            components={{ header: { cell: ResizableTitle } }}
                            dataSource={visibleFiles.slice((page - 1) * pageSize, page * pageSize).map((f, i) => ({ ...f, key: (page - 1) * pageSize + i }))}
                            size="small"
                            scroll={{ x: totalW, y: tbodyH }}
                            tableLayout="fixed"
                            locale={{ emptyText: tokens.length ? '无匹配条目' : '暂无数据' }}
                            pagination={false}
                        />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 6 }}>
                        <Pagination
                            size="small" simple
                            current={page} pageSize={pageSize} total={visibleFiles.length}
                            pageSizeOptions={['5', '10', '20', '50']}
                            showSizeChanger
                            onChange={(p, ps) => { setPage(p); setPageSize(ps) }}
                        />
                    </div>
                </div>
            </Card>

            {/* 编辑记录：元数据表单（命名字段改动会同步改名并重新切片） */}
            <Modal
                title={`编辑记录：${editStem}`}
                open={editOpen}
                onOk={doEditSave}
                onCancel={() => setEditOpen(false)}
                okText="保存" cancelText="取消"
                confirmLoading={editBusy}
                okButtonProps={{ disabled: !editChanged }}
                width={560}
            >
                <Spin spinning={editLoading}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 12, rowGap: 6 }}>
                        {editFields.map(f => {
                            const val = (editVals[f.k] ?? '')
                            let opts = f.opts
                            if (f.k === 'defectType' && val && !DEFECT_LABELS[val]) {
                                opts = [{ value: val, label: val }, ...(opts || [])]
                            }
                            return (
                                <div key={f.k}>
                                    <div style={{ fontSize: 12, color: '#888', marginBottom: 2 }}>{f.label}</div>
                                    {f.kind === 'select'
                                        ? <Select size="small" style={{ width: '100%' }} showSearch optionFilterProp="label"
                                            value={val || undefined} options={opts}
                                            onChange={v => setEditVals(p => ({ ...p, [f.k]: v }))} />
                                        : <Input size="small" style={{ width: '100%' }} value={val}
                                            onChange={e => setEditVals(p => ({ ...p, [f.k]: e.target.value }))} />}
                                </div>
                            )
                        })}
                        <div style={{ gridColumn: '1 / -1' }}>
                            <div style={{ fontSize: 12, color: '#888', marginBottom: 2 }}>描述</div>
                            <Input.TextArea rows={2} value={editVals.description || ''}
                                onChange={e => setEditVals(p => ({ ...p, description: e.target.value }))} />
                        </div>
                        <div style={{ gridColumn: '1 / -1', color: '#aaa', fontSize: 12 }}>
                            命名字段（缺陷/结构/方法/项目/纤维/基体/牌号）改动会同步改名并重新切片；时间戳留空沿用原名。
                        </div>
                    </div>
                </Spin>
            </Modal>
        </div>
    )
}
