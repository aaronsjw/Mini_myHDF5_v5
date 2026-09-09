import React, { useState, useEffect } from 'react'
import { Card, Table, Tag, Statistic, Row, Col, Spin, Tooltip, Input, Select, Button, Space, Modal, message } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import axios from 'axios'

// 命名规则中 缺陷类型 对应的中文
const DEFECT_LABELS = {
    OK: { color: 'green', text: '好区' },
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
    model: '型号',
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

export default function DatabaseOverview({
    endpoint = 'http://127.0.0.1:8000/dataset_overview',
    dirLabel = 'AScan 数据目录',
    dirPath = 'dataset/ascan_dataset',
    extraColumns = [],
    imageUrlFn = null,
    mergeMaterial = false,
    manageBase = '',   // 如 'http://127.0.0.1:8000/cscan/raw'：非空时文件列表显示 编辑/删除
}) {
    const [data, setData] = useState(null)
    const [loading, setLoading] = useState(true)
    const [kw, setKw] = useState('')   // 文件列表搜索关键字（& = 且）
    const [editOpen, setEditOpen] = useState(false)
    const [editLoading, setEditLoading] = useState(false)
    const [editBusy, setEditBusy] = useState(false)
    const [editStem, setEditStem] = useState('')
    const [editVals, setEditVals] = useState({})

    const refresh = () => {
        axios.get(endpoint).then(res => setData(res.data)).catch(err => console.error(err))
    }

    // 编辑：拉 /cscan/raw/item 的边车 meta 填充表单
    const openEdit = (stem) => {
        setEditStem(stem); setEditOpen(true); setEditLoading(true); setEditVals({})
        axios.get(`${manageBase}/item`, { params: { stem } })
            .then(r => {
                const meta = r.data?.meta || {}
                setEditVals({
                    fiber: meta.fiber || '', matrix: meta.matrix || '',
                    structure: meta.structure || '', method: meta.method || '',
                    defectType: meta.defectType || '', code: meta.code || '',
                    fiberGrade: meta.fiberGrade || '', matrixGrade: meta.matrixGrade || '',
                    probe_type: meta.probe_type || '', description: meta.description || '',
                    timestamp: meta.timestamp || '',
                })
            })
            .catch(() => { message.error('读取该记录失败'); setEditOpen(false) })
            .finally(() => setEditLoading(false))
    }
    const doEditSave = () => {
        setEditBusy(true)
        axios.put(`${manageBase}/${encodeURIComponent(editStem)}`, { meta: editVals })
            .then(r => {
                if (r.data?.error) { message.error(r.data.error); return }
                setEditOpen(false)
                message.success(`已更新 → ${r.data.filename}`)
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
            content: <span>将移除原图/元数据/框，并删除派生切片、清理训练划分。<br /><b>{filename}</b></span>,
            okText: '删除', okButtonProps: { danger: true }, cancelText: '取消',
            onOk: () => doDelete(stem),
        })
    }

    const editFields = [
        { k: 'defectType', label: '缺陷类型', kind: 'select', opts: DEFECT_OPTS },
        { k: 'structure', label: '结构', kind: 'select', opts: STRUCT_OPTS.map(v => ({ value: v, label: v })) },
        { k: 'method', label: '方法', kind: 'select', opts: METHOD_OPTS.map(v => ({ value: v, label: v })) },
        { k: 'code', label: '型号', kind: 'input' },
        { k: 'fiber', label: '纤维', kind: 'select', opts: FIBER_OPTS.map(v => ({ value: v, label: v })) },
        { k: 'matrix', label: '基体', kind: 'select', opts: MATRIX_OPTS.map(v => ({ value: v, label: v })) },
        { k: 'fiberGrade', label: '纤维牌号', kind: 'input' },
        { k: 'matrixGrade', label: '基体牌号', kind: 'input' },
        { k: 'probe_type', label: '探头', kind: 'input' },
        { k: 'timestamp', label: '时间戳(14位)', kind: 'input' },
    ]

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

    // 按缺陷类型分组的列（Db 按结构拆分为 板板脱粘 / 板芯脱粘）
    const defectColumns = [
        { title: '缺陷类型', dataIndex: 'defect', key: 'defect', render: (d, record) => {
            const info = DEFECT_LABELS[d] || { color: 'default', text: d }
            return <Tag color={info.color}>{record.sub ? `Db · ${record.sub}` : `${d} — ${info.text}`}</Tag>
        }},
        { title: '文件数量', dataIndex: 'count', key: 'count' }
    ]

    // 分组数据：Db 按结构细分（BondPP=板板脱粘, BondSC=板芯脱粘），其余保持原样
    const dbSubCount = {}
    data.files.forEach(f => {
        if (f.defect === 'Db') {
            const sub = DB_STRUCTURE_TEXT[f.structure] || '脱粘'
            dbSubCount[sub] = (dbSubCount[sub] || 0) + 1
        }
    })
    const defectData = []
    Object.entries(data.by_defect).forEach(([defect, v]) => {
        if (defect === 'Db' && Object.keys(dbSubCount).length) {
            Object.entries(dbSubCount).forEach(([sub, count]) => {
                defectData.push({ key: `Db-${sub}`, defect: 'Db', sub, count })
            })
        } else {
            defectData.push({ key: defect, defect, sub: null, count: v.count })
        }
    })

    // 文件详情列
    const fileColumns = [
        ...(imageUrlFn ? [{
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
        { title: '文件名', dataIndex: 'filename', key: 'filename', width: 320, ellipsis: true },
        ...(mergeMaterial
            ? [{ title: '纤维/基体', key: 'fiberMatrix', width: 90, render: (_, r) => `${r.fiber}/${r.matrix}` }]
            : [
                { title: '纤维类型', dataIndex: 'fiber', key: 'fiber', width: 80 },
                { title: '基体类型', dataIndex: 'matrix', key: 'matrix', width: 80 },
            ]),
        { title: '结构', dataIndex: 'structure', key: 'structure', width: 100 },
        { title: '检测方法', dataIndex: 'method', key: 'method', width: 90 },
        {
            title: '缺陷类型',
            dataIndex: 'defect',
            key: 'defect',
            width: 130,
            render: (d, record) => {
                const info = DEFECT_LABELS[d] || { color: 'default', text: d }
                const text = d === 'Db' && DB_STRUCTURE_TEXT[record.structure]
                    ? `Db · ${DB_STRUCTURE_TEXT[record.structure]}`
                    : d
                return <Tag color={info.color}>{text}</Tag>
            }
        },
        { title: '型号', dataIndex: 'model', key: 'model', width: 80 },
        ...extraColumns,
        ...(manageBase ? [{
            title: '操作', key: 'ops', width: 120,
            render: (_, r) => {
                const stem = String(r.filename).replace(/\.[^.]+$/, '')
                return (
                    <Space size={4}>
                        <Button size="small" onClick={() => openEdit(stem)}>编辑</Button>
                        <Button size="small" danger onClick={() => askDelete(stem, r.filename)}>删除</Button>
                    </Space>
                )
            },
        }] : []),
    ]

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* 第一行：统计卡片：总文件数，缺陷类型数，最大缺陷组，数据集目录 */}
            <Row gutter={16}>
                <Col span={6}>
                    <Card size="small">
                        <Statistic title="总文件数" value={data.total_files} />
                    </Card>
                </Col>
                <Col span={6}>
                    <Card size="small">
                        <Statistic title="缺陷类型数" value={Object.keys(data.by_defect).length} />
                    </Card>
                </Col>
                <Col span={6}>
                    <Card size="small">
                        <Statistic title="最大缺陷组" value={Math.max(...Object.values(data.by_defect).map(v => v.count))} />
                    </Card>
                </Col>
                <Col span={6}>
                    <Card size="small">
                        <Statistic title={dirLabel} value={dirPath} />
                    </Card>
                </Col>
            </Row>

            {/* 第二行：按缺陷类型分组 */}
            <Card title="按缺陷类型分组" size="small">
                <Table
                    columns={defectColumns}
                    dataSource={defectData}
                    pagination={false}
                    size="small"
                />
            </Card>

            {/* 第三行：文件列表 */}
            <Card
                title="文件列表"
                size="small"
                style={{ flex: 1, overflow: 'auto' }}
                bodyStyle={{ padding: 8 }}
                extra={
                    <Input
                        allowClear
                        prefix={<SearchOutlined style={{ color: '#999' }} />}
                        placeholder="搜索（& 表示且），如 T1100&Plate"
                        value={kw}
                        onChange={e => setKw(e.target.value)}
                        style={{ width: 280 }}
                    />
                }
            >
                <Table
                    columns={fileColumns}
                    dataSource={visibleFiles.map((f, i) => ({ ...f, key: i }))}
                    size="small"
                    locale={{ emptyText: tokens.length ? '无匹配条目' : '暂无数据' }}
                    pagination={{ pageSize: 5, showSizeChanger: true, showTotal: t => `共 ${t} 个文件`, pageSizeOptions: ['5', '10', '20', '50'] }}
                />
            </Card>

            {/* 编辑记录：元数据表单（命名字段改动会同步改名并重新切片） */}
            <Modal
                title={`编辑记录：${editStem}`}
                open={editOpen}
                onOk={doEditSave}
                onCancel={() => setEditOpen(false)}
                okText="保存" cancelText="取消"
                confirmLoading={editBusy}
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
                            命名字段（缺陷/结构/方法/型号/纤维/基体/牌号）改动会同步改名并重新切片；时间戳留空沿用原名。
                        </div>
                    </div>
                </Spin>
            </Modal>
        </div>
    )
}
