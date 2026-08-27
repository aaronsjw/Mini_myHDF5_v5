import React, { useState, useEffect } from 'react'
import { Card, Table, Tag, Statistic, Row, Col, Spin } from 'antd'
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

export default function DatabaseOverview() {
    const [data, setData] = useState(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        axios.get('http://127.0.0.1:8000/dataset_overview')
            .then(res => setData(res.data))
            .catch(err => console.error(err))
            .finally(() => setLoading(false))
    }, [])

    if (loading) return <Spin size="large" style={{ display: 'block', marginTop: 100 }} />
    if (!data || data.error) return <div style={{ padding: 40, color: '#999' }}>未找到 dataset 目录</div>

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
        { title: '文件名', dataIndex: 'filename', key: 'filename', width: 320, ellipsis: true },
        { title: '纤维类型', dataIndex: 'fiber', key: 'fiber', width: 80 },
        { title: '基体类型', dataIndex: 'matrix', key: 'matrix', width: 80 },
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
                        <Statistic title="数据集目录" value="dataset/" />
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
            >
                <Table
                    columns={fileColumns}
                    dataSource={data.files.map((f, i) => ({ ...f, key: i }))}
                    size="small"
                    pagination={{ pageSize: 5, showSizeChanger: true, showTotal: t => `共 ${t} 个文件`, pageSizeOptions: ['5', '10', '20', '50'] }}
                />
            </Card>
        </div>
    )
}
