// CScan 智能检测面板：上传 C 扫图 → YOLO 自动切块检测 → 物理尺寸 → HB 验收判定
import React, { useState, useEffect, useRef } from 'react'
import {
    Card, Button, Upload, Select, InputNumber, Tag, Table,
    Descriptions, Alert, Space, Divider, Row, Col, Spin, Empty, message,
} from 'antd'
import { UploadOutlined, PlayCircleOutlined, RobotOutlined, ReloadOutlined } from '@ant-design/icons'
import axios from 'axios'

const API = 'http://127.0.0.1:8000'
const ABBR_COLORS = { Dl: '#f5222d', Db: '#fa8c16', Po: '#fadb14' }
const GRADE_OPTIONS = ['A', 'B', 'C'].map(g => ({ value: g, label: `${g} 级` }))

export default function CScanPanel({ onSendToAI }) {
    const [models, setModels] = useState([])
    const [available, setAvailable] = useState(false)
    const [modelNote, setModelNote] = useState('')
    const [selectedModel, setSelectedModel] = useState(null)

    const [rawFiles, setRawFiles] = useState([])        // raw/ 样例清单 {filename,...}
    const [file, setFile] = useState(null)               // 上传的 File
    const [fileName, setFileName] = useState('')
    const [imgUrl, setImgUrl] = useState('')
    const [imgSize, setImgSize] = useState(null)         // {w,h} natural

    const [mmPerPxInput, setMmPerPxInput] = useState(null)   // 直接 mm/px
    const [physWidthMm, setPhysWidthMm] = useState(null)     // 图幅物理宽 → 自动算 mm/px
    const [grade, setGrade] = useState('C')
    const [analyzing, setAnalyzing] = useState(false)
    const [result, setResult] = useState(null)

    const canvasRef = useRef(null)
    const imgElRef = useRef(null)

    // 初始化：拉模型清单 + raw 样例
    useEffect(() => {
        axios.get(`${API}/cscan/models`)
            .then(res => {
                setAvailable(res.data.available)
                setModels(res.data.models || [])
                setModelNote(res.data.note || '')
                if (res.data.models?.length) setSelectedModel(res.data.models[0].name)
            })
            .catch(() => message.error('无法获取 CScan 模型清单'))
        axios.get(`${API}/cscan_dataset`)
            .then(res => {
                if (res.data && !res.data.error) setRawFiles(res.data.files || [])
            })
            .catch(() => {})
    }, [])

    const setImage = (f, name) => {
        setFile(f)
        setFileName(name || f?.name || '')
        setResult(null)
        setImgSize(null)
        if (imgUrl) URL.revokeObjectURL(imgUrl)
        setImgUrl(f ? URL.createObjectURL(f) : '')
    }

    // 加载 raw 样例图（经 /cscan/image）
    const loadSample = (name) => {
        if (!name) return
        axios.get(`${API}/cscan/image?name=${encodeURIComponent(name)}`, { responseType: 'blob' })
            .then(res => {
                const f = new File([res.data], name, { type: res.data.type || 'image/png' })
                setImage(f, name)
            })
            .catch(() => message.error('样例图加载失败'))
    }

    // 读取图片自然尺寸（用于自动算 mm/px 与画框缩放）
    useEffect(() => {
        if (!imgUrl) { imgElRef.current = null; return }
        const img = new Image()
        img.onload = () => { imgElRef.current = img; setImgSize({ w: img.naturalWidth, h: img.naturalHeight }) }
        img.src = imgUrl
    }, [imgUrl])

    const mmPerPx = mmPerPxInput ?? (physWidthMm && imgSize?.w ? physWidthMm / imgSize.w : null)

    // 识别
    const doAnalyze = async () => {
        if (!file) { message.warning('请先选择 C 扫图'); return }
        if (!available) { message.error('ultralytics 不可用（请用 cscan_env 跑后端）'); return }
        if (!models.length) { message.error('没有可用模型'); return }
        setAnalyzing(true)
        setResult(null)
        const fd = new FormData()
        fd.append('file', file)
        fd.append('model', selectedModel || models[0].name)
        fd.append('grade', grade)
        if (mmPerPx) fd.append('mm_per_px', String(Number(mmPerPx.toFixed(6))))
        try {
            const res = await axios.post(`${API}/cscan/analyze`, fd)
            if (res.data?.error) { message.error(res.data.error); return }
            setResult(res.data)
        } catch (e) {
            message.error(`分析失败: ${e?.response?.data?.error || e.message || ''}`)
        } finally {
            setAnalyzing(false)
        }
    }

    // 画框
    useEffect(() => {
        const c = canvasRef.current, img = imgElRef.current
        if (!c) return
        if (!img || !result) { c.width = 0; c.height = 0; return }
        const W = img.naturalWidth, H = img.naturalHeight
        const maxW = 820
        const scale = W > maxW ? maxW / W : 1
        c.width = Math.round(W * scale); c.height = Math.round(H * scale)
        const ctx = c.getContext('2d')
        ctx.drawImage(img, 0, 0, c.width, c.height)
        const s = c.width / W
        for (const d of (result.cscan?.detections || [])) {
            const [x1, y1, x2, y2] = d.xyxy
            const color = ABBR_COLORS[d.class_name_en] || '#1890ff'
            ctx.lineWidth = 2; ctx.strokeStyle = color
            ctx.strokeRect(x1 * s, y1 * s, (x2 - x1) * s, (y2 - y1) * s)
            ctx.fillStyle = color
            ctx.font = 'bold 13px sans-serif'
            ctx.fillText(`${d.class_name_zh} ${(d.confidence * 100).toFixed(0)}%`,
                x1 * s, Math.max(y1 * s - 6, 14))
        }
    }, [result, imgSize, imgUrl])

    const clearAll = () => {
        setImage(null, '')
        setResult(null)
    }

    const sendToAI = () => {
        if (!result) { message.warning('请先执行识别'); return }
        if (onSendToAI) {
            onSendToAI({
                cscan: result.cscan,
                v5_context: result.v5_context,
                authoritative_defect_type: result.authoritative_defect_type,
                authoritative_defect_abbr: result.authoritative_defect_abbr,
                authoritative_source: result.authoritative_source,
                acceptance: result.acceptance,
            })
        }
    }

    // ── 验收卡 ──
    const acc = result?.acceptance
    const renderAcceptance = () => {
        if (!acc) return null
        if (acc.error) return <Alert type="warning" showIcon message="验收出错" description={acc.error} />
        const p = acc.passed
        const type = p === true ? 'success' : p === false ? 'error' : 'warning'
        const title = p === true ? '✅ 合格' : p === false ? '❌ 不合格' : '⚠️ 无法判定'
        return (
            <Alert type={type} showIcon style={{ marginTop: 12 }}
                message={<Space><b>{title}</b><Tag>{acc.standard_id}</Tag>
                    {acc.cscan_evaluated && <Tag color="geekblue">{acc.cscan_grade} 级（CScan 尺寸判定）</Tag>}</Space>}
                description={
                    <div>
                        <div style={{ whiteSpace: 'pre-wrap' }}>{acc.reason}</div>
                        {acc.violations?.length > 0 && <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
                            {acc.violations.map((v, i) => <li key={i}><b>[{v.level}]</b> {v.description}（{v.action}）</li>)}
                        </ul>}
                        {acc.suggestions?.length > 0 && <div style={{ marginTop: 6 }}>💡 {acc.suggestions.join('；')}</div>}
                    </div>
                }
            />
        )
    }

    const detections = result?.cscan?.detections || []
    const stats = result?.cscan?.stats || {}

    return (
        <div style={{ background: '#fff', borderRadius: 8, padding: 20, minHeight: '100%' }}>
            <Row gutter={16} align="middle" style={{ marginBottom: 8 }}>
                <Col flex="auto">
                    <Space>
                        <b style={{ fontSize: 16 }}>C-Scan 智能检测</b>
                        <Tag color={available ? 'green' : 'red'}>{available ? 'ultralytics 就绪' : '不可用'}</Tag>
                    </Space>
                    {modelNote && <div style={{ color: '#fa8c16', fontSize: 12 }}>{modelNote}</div>}
                </Col>
                <Col>
                    <Space>
                        <Button icon={<ReloadOutlined />} onClick={clearAll} disabled={!file && !result}>清空</Button>
                        <Button type="primary" icon={<RobotOutlined />} onClick={sendToAI} disabled={!result || analyzing}>发送给AI评估</Button>
                    </Space>
                </Col>
            </Row>

            <Space wrap style={{ marginBottom: 12 }}>
                <Upload accept=".bmp,.png,.jpg,.jpeg" showUploadList={false}
                    beforeUpload={(f) => { setImage(f, f.name); return false }}>
                    <Button icon={<UploadOutlined />} type={file ? 'default' : 'primary'}>选择 C 扫图</Button>
                </Upload>
                <Select style={{ width: 300 }} placeholder="从 raw 样例库选一张测试"
                    showSearch optionFilterProp="label"
                    value={null}
                    onChange={loadSample}
                    options={rawFiles.map(r => ({ value: r.filename, label: r.filename }))} />
                <Select style={{ width: 140 }} value={selectedModel} onChange={setSelectedModel}
                    options={models.map(m => ({ value: m.name, label: m.name }))} placeholder="模型" />
                <Select style={{ width: 90 }} value={grade} onChange={setGrade} options={GRADE_OPTIONS} />
                <InputNumber addonBefore="mm/px" style={{ width: 150 }} value={mmPerPxInput} onChange={setMmPerPxInput}
                    placeholder="留空由宽度自动算" min={0} step={0.01} />
                <InputNumber addonBefore="图幅宽mm" style={{ width: 140 }} value={physWidthMm} onChange={setPhysWidthMm}
                    placeholder="自动换算比例" min={0} step={1} disabled={mmPerPxInput != null} />
                <Button type="primary" icon={<PlayCircleOutlined />} onClick={doAnalyze} loading={analyzing}
                    disabled={!file || !available}>开始识别</Button>
            </Space>

            {fileName && <Tag color="blue" style={{ marginBottom: 10 }}>{fileName} {imgSize ? `(${imgSize.w}×${imgSize.h})` : ''}</Tag>}
            {mmPerPx && <Tag color="purple" style={{ marginBottom: 10 }}>mm/px = {mmPerPx.toFixed(4)}</Tag>}

            {!imgUrl && !file && <Empty description="请选择一张 C 扫图开始" style={{ marginTop: 60 }} />}

            <div style={{ textAlign: 'center' }}>
                <canvas ref={canvasRef} style={{ border: '1px solid #e8e8e8', borderRadius: 6, maxWidth: '100%', background: '#000' }} />
            </div>

            {analyzing && <div style={{ textAlign: 'center', padding: 20 }}><Spin tip="YOLO 检测中…" /></div>}

            {result && (
                <>
                    {result.discrepancy_warning &&
                        <Alert type="warning" showIcon message="A-Scan / C-Scan 不一致"
                            description={result.discrepancy_warning} style={{ marginTop: 12 }} />}

                    {renderAcceptance()}

                    <Divider orientation="left">检测结果</Divider>
                    <Descriptions size="small" column={4} style={{ marginBottom: 12 }}>
                        <Descriptions.Item label="权威缺陷类型">
                            <b>{result.authoritative_defect_type || '-'}</b>{result.authoritative_defect_abbr &&
                                <Tag style={{ marginLeft: 6 }}>{result.authoritative_defect_abbr}</Tag>}
                        </Descriptions.Item>
                        <Descriptions.Item label="类型来源">
                            <Tag color={result.authoritative_source === 'v5_ascan' ? 'green' : 'orange'}>
                                {result.authoritative_source === 'v5_ascan' ? 'v5 A-Scan' : 'YOLO 推断'}
                            </Tag>
                        </Descriptions.Item>
                        <Descriptions.Item label="检出缺陷">共 {stats.count} 处</Descriptions.Item>
                        <Descriptions.Item label="图幅物理尺寸">
                            {result.cscan?.image?.physical_w_mm
                                ? `${result.cscan.image.physical_w_mm} × ${result.cscan.image.physical_h_mm} mm`
                                : '-'}
                        </Descriptions.Item>
                        <Descriptions.Item label="总面积">{stats.total_area_mm2 ?? '-'} mm²</Descriptions.Item>
                        <Descriptions.Item label="面积占比">{stats.total_area_pct != null ? `${stats.total_area_pct} %` : '-'}</Descriptions.Item>
                        <Descriptions.Item label="最大 Z">{stats.max_z_mm ?? '-'} mm</Descriptions.Item>
                        <Descriptions.Item label="相邻缺陷最小间距">{stats.min_edge_gap_mm ?? '-'} mm</Descriptions.Item>
                    </Descriptions>

                    {result.v5_context?.has_nde && (
                        <div style={{ marginBottom: 12 }}>
                            <Tag color="cyan">已关联 A-Scan：{result.v5_context.filename} → {result.v5_context.ascan_defect_type || '-'} ({result.v5_context.ascan_defect_abbr || '-'})</Tag>
                        </div>
                    )}

                    <Table size="small" rowKey="index" pagination={false}
                        dataSource={detections}
                        columns={[
                            { title: '#', dataIndex: 'index', width: 40, render: i => i + 1 },
                            { title: '类别', dataIndex: 'class_name_zh', width: 90,
                              render: (t, r) => <Tag color={ABBR_COLORS[r.class_name_en]}>{t} {r.class_name_en}</Tag> },
                            { title: '置信度', width: 80, render: (_, r) => `${(r.confidence * 100).toFixed(1)}%` },
                            { title: '尺寸 w×h (mm)', width: 120,
                              render: (_, r) => r.w_mm != null ? `${r.w_mm}×${r.h_mm}` : `${r.w_px}×${r.h_px}px` },
                            { title: 'Z=(X+Y)/2 (mm)', width: 110, render: (_, r) => r.z_mm ?? '-' },
                            { title: '面积 (mm²)', width: 90, render: (_, r) => r.area_mm2 ?? '-' },
                            { title: '面积占比', width: 80, render: (_, r) => r.area_pct != null ? `${r.area_pct}%` : '-' },
                        ]}
                    />
                </>
            )}
        </div>
    )
}
