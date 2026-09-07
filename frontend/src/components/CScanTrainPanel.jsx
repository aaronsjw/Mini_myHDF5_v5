// CScan 图像 YOLO 训练面板（模型训练 → 超声 CScan）
// 结构与视觉对齐 AScan TrainingPanel：数据集概览 / 训练配置 / 进度 / 实时曲线 / 结果图 / 已训练模型表
import React, { useState, useEffect, useRef } from 'react'
import {
    Card, Button, Progress, Statistic, Row, Col, Table, Tag, Select,
    InputNumber, message, Spin, Empty, Alert, Tooltip,
} from 'antd'
import ReactECharts from 'echarts-for-react'
import axios from 'axios'

const API = 'http://127.0.0.1:8000'
const IMG_COLORS = { Dl: '#f5222d', Db: '#fa8c16', Po: '#fadb14' }

const baseOptions = () => {
    const opt = [
        { value: 'yolov8n.pt', label: 'yolov8n.pt（官方预训练）' },
        { value: 'yolo11n.pt', label: 'yolo11n.pt（官方预训练）' },
    ]
    return opt
}

export default function CScanTrainPanel({ active }) {
    const [preview, setPreview] = useState(null)
    const [models, setModels] = useState([])

    // 训练配置
    const [epochs, setEpochs] = useState(30)
    const [imgsz, setImgsz] = useState(640)
    const [batch, setBatch] = useState(4)
    const [patience, setPatience] = useState(30)
    const [seed, setSeed] = useState(42)
    const [device, setDevice] = useState('cpu')
    const [base, setBase] = useState('yolov8n.pt')

    // 任务状态
    const [jobId, setJobId] = useState(null)
    const [status, setStatus] = useState(null)
    const [progress, setProgress] = useState(0)
    const [epochNow, setEpochNow] = useState(0)
    const [statusText, setStatusText] = useState('')
    const [result, setResult] = useState(null)
    const [error, setError] = useState(null)
    const [history, setHistory] = useState([])   // 实时曲线点

    const pollTimer = useRef(null)
    const lastEpochRef = useRef(-1)
    const isRunning = ['pending', 'loading', 'training'].includes(status)

    const loadModels = () => axios.get(`${API}/cscan/train/models`).then(r => setModels(r.data.models || [])).catch(() => {})
    const loadPreview = () => axios.get(`${API}/cscan/train/preview`).then(r => setPreview(r.data)).catch(() => {})

    useEffect(() => { if (active) { loadPreview(); loadModels() } }, [active])

    // 轮询训练状态
    useEffect(() => {
        if (!jobId) return
        const poll = () => axios.get(`${API}/cscan/train/status/${jobId}`).then(res => {
            const s = res.data
            setStatus(s.status)
            setProgress(s.progress || 0)
            if (s.epoch != null) setEpochNow(s.epoch)
            if (s.status === 'loading') setStatusText('划分数据集 + 初始化…')
            else if (s.status === 'training') {
                setStatusText('训练中…')
                if (s.current && s.current.epoch != null && s.current.epoch !== lastEpochRef.current) {
                    lastEpochRef.current = s.current.epoch
                    setHistory(prev => [...prev, s.current])
                }
            } else if (s.status === 'error') {
                setError(s.error); setStatusText('训练出错'); clearInterval(pollTimer.current)
            } else if (s.status === 'done') {
                setStatusText('训练完成'); clearInterval(pollTimer.current); loadModels()
                axios.get(`${API}/cscan/train/result/${jobId}`)
                    .then(r => setResult(r.data))
                    .catch(() => message.error('获取训练结果失败'))
            }
        }).catch(() => { clearInterval(pollTimer.current); setStatus('error'); setError('连接失败') })
        poll()
        pollTimer.current = setInterval(poll, 2000)
        return () => clearInterval(pollTimer.current)
    }, [jobId])

    const handleStart = () => {
        if (epochs < 1) { message.warning('训练轮次至少 1'); return }
        setStatus('pending'); setProgress(0); setStatusText('排队中…')
        setResult(null); setError(null); setHistory([]); lastEpochRef.current = -1
        axios.post(`${API}/cscan/train/start`, {
            epochs, imgsz, batch, patience, seed, device, base,
        }).then(res => setJobId(res.data.job_id)).catch(err => {
            message.error('启动训练失败'); setStatus('error'); setError(err.message)
        })
    }
    const reset = () => {
        setJobId(null); setStatus(null); setProgress(0); setResult(null); setError(null); setStatusText(''); setHistory([])
    }
    const handleDelete = (name) => {
        axios.delete(`${API}/cscan/train/models/${name}`).then(() => { message.success('已删除'); loadModels() }).catch(() => message.error('删除失败'))
    }

    const clsColors = (c) => IMG_COLORS[c] || '#888'
    const avail = preview?.available
    const curveSeries = (result?.history?.length ? result.history : history).length
        ? (result?.history?.length ? result.history : history)
        : []

    const historyOption = curveSeries.length ? {
        tooltip: { trigger: 'axis' },
        legend: { data: ['mAP50', 'mAP50-95', 'val/cls_loss'], top: 0 },
        grid: { left: 50, right: 50, top: 36, bottom: 30 },
        xAxis: { type: 'category', data: curveSeries.map(r => `E${r.epoch}`) },
        yAxis: [
            { type: 'value', name: 'mAP', min: 0, max: 1 },
            { type: 'value', name: 'loss', inverse: true },
        ],
        series: [
            { name: 'mAP50', type: 'line', smooth: true, data: curveSeries.map(r => r.mAP50), lineStyle: { color: '#52c41a', width: 2 }, itemStyle: { color: '#52c41a' } },
            { name: 'mAP50-95', type: 'line', smooth: true, data: curveSeries.map(r => r.mAP50_95), lineStyle: { color: '#1890ff', width: 2 }, itemStyle: { color: '#1890ff' } },
            { name: 'val/cls_loss', type: 'line', smooth: true, yAxisIndex: 1, data: curveSeries.map(r => r.val_cls_loss), lineStyle: { color: '#faad14', width: 2 }, itemStyle: { color: '#faad14' } },
        ],
    } : null

    const plotNames = result?.plot_images || []
    const runName = result?.run_name || ''

    // 起始权重下拉 = 预训练 + 已收编模型
    const allBase = [
        ...baseOptions().filter(o => preview?.pretrained?.includes(o.value) || o.value === base),
        ...(models.map(m => ({ value: m.model_file, label: `${m.model_file}（续训）` }))),
    ]

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 12, overflow: 'auto', paddingRight: 4 }}>
            {!preview ? (
                <Spin size="large" style={{ display: 'block', margin: '80px auto' }} />
            ) : preview.error ? (
                <Empty description="预览加载失败" style={{ marginTop: 80 }} />
            ) : (
                <>
                    {!avail && <Alert type="error" showIcon message="ultralytics 未安装（请用 cscan_env 运行后端）" />}

                    {/* ═══ 数据集概览 ═══ */}
                    <Row gutter={12} align="stretch">
                        <Col span={8}>
                            <Card size="small" title="CScan 数据集概览" style={{ height: '100%' }}>
                                <div style={{ marginBottom: 16 }}><span style={{ color: 'rgba(0,0,0,0.45)' }}>训练 tile：</span><strong>{preview.n_train}</strong></div>
                                <div style={{ marginBottom: 16 }}><span style={{ color: 'rgba(0,0,0,0.45)' }}>验证 tile：</span><strong>{preview.n_val}</strong></div>
                                <div style={{ marginBottom: 16 }}><span style={{ color: 'rgba(0,0,0,0.45)' }}>类别：</span>
                                    {(preview.classes || []).map(c => <Tag key={c.code} color={clsColors(c.code)}>{c.code}-{c.zh}</Tag>)}</div>
                                <div><span style={{ color: 'rgba(0,0,0,0.45)' }}>已收编模型：</span><strong>{models.length}</strong></div>
                            </Card>
                        </Col>
                        <Col span={8}>
                            <Card size="small" title="说明" style={{ height: '100%' }}>
                                <div style={{ fontSize: 13, color: '#666', lineHeight: 1.8 }}>
                                    YOLO 目标检测（Dl/Db/Po）。每次训练前自动按原图分组重划 train/val（seed 可固定）。
                                    <br />训练默认 CPU（本机 GPU 仅 2GB，易 OOM），可选手动切 GPU。
                                </div>
                            </Card>
                        </Col>
                        <Col span={8}>
                            <Card size="small" title="检测方法/模型" style={{ height: '100%' }}>
                                <div style={{ marginBottom: 8 }}><span style={{ color: 'rgba(0,0,0,0.45)' }}>预训练可选：</span>{(preview.pretrained || []).join(' / ') || '-'}</div>
                                <div><span style={{ color: 'rgba(0,0,0,0.45)' }}>模型输出目录：</span>backend/cscan_models（analyze 可用）</div>
                            </Card>
                        </Col>
                    </Row>

                    {/* ═══ 训练配置 ═══ */}
                    <Card size="small" title="训练配置">
                        <Row gutter={16} align="middle">
                            <Col span={3}><div style={{ marginBottom: 4, color: '#999' }}>训练轮次</div>
                                <InputNumber min={1} max={300} value={epochs} onChange={setEpochs} disabled={isRunning} style={{ width: '100%' }} /></Col>
                            <Col span={3}><div style={{ marginBottom: 4, color: '#999' }}>imgsz</div>
                                <Select value={imgsz} onChange={setImgsz} style={{ width: '100%' }} disabled={isRunning}
                                    options={[320, 640, 1280].map(v => ({ value: v, label: `${v}` }))} /></Col>
                            <Col span={3}><div style={{ marginBottom: 4, color: '#999' }}>batch</div>
                                <Select value={batch} onChange={setBatch} style={{ width: '100%' }} disabled={isRunning}
                                    options={[2, 4, 8].map(v => ({ value: v, label: `${v}` }))} /></Col>
                            <Col span={3}><div style={{ marginBottom: 4, color: '#999' }}>patience(早停)</div>
                                <InputNumber min={0} max={200} value={patience} onChange={setPatience} disabled={isRunning} style={{ width: '100%' }} /></Col>
                            <Col span={3}><div style={{ marginBottom: 4, color: '#999' }}>seed</div>
                                <InputNumber min={0} max={99} value={seed} onChange={setSeed} disabled={isRunning} style={{ width: '100%' }} /></Col>
                            <Col span={3}><div style={{ marginBottom: 4, color: '#999' }}>device</div>
                                <Select value={device} onChange={setDevice} style={{ width: '100%' }} disabled={isRunning}
                                    options={[{ value: 'cpu', label: 'CPU' }, { value: '0', label: 'GPU(0)' }]} /></Col>
                            <Col span={6}><div style={{ marginBottom: 4, color: '#999' }}>起始权重</div>
                                <Select value={base} onChange={setBase} style={{ width: '100%' }} disabled={isRunning}
                                    showSearch optionFilterProp="label" options={allBase} /></Col>
                            <Col span={3}><div style={{ marginBottom: 4, color: '#999' }}>&nbsp;</div>
                                <Button type="primary" block size="large" onClick={handleStart} disabled={isRunning} loading={isRunning}>
                                    {isRunning ? '训练中…' : '开始训练'}
                                </Button></Col>
                            <Col span={2}><div style={{ marginBottom: 4, color: '#999' }}>&nbsp;</div>
                                <Button block size="large" onClick={reset} disabled={!result && status !== 'error'}>重置</Button></Col>
                        </Row>
                    </Card>

                    {/* ═══ 进度 ═══ */}
                    {status && (
                        <Card size="small">
                            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                                <Progress percent={progress}
                                    status={status === 'error' ? 'exception' : 'active'}
                                    strokeColor={status === 'done' ? '#52c41a' : undefined}
                                    style={{ flex: 1, margin: 0 }} />
                                <span style={{ color: '#999', whiteSpace: 'nowrap', fontSize: 13 }}>
                                    {status === 'training' ? `epoch ${epochNow}/${epochs} · ` : ''}{statusText}
                                    {status === 'done' && ' ✅'}{status === 'error' && ' ❌'}
                                </span>
                            </div>
                        </Card>
                    )}

                    {/* ═══ 实时/结果曲线 ═══ */}
                    {historyOption && (
                        <Card size="small" title="训练曲线（mAP / loss per epoch）" bodyStyle={{ padding: 4 }}>
                            <ReactECharts option={historyOption} style={{ height: 260 }} />
                        </Card>
                    )}

                    {/* ═══ 结果 ═══ */}
                    {result && (
                        <>
                            <Card size="small">
                                <Row gutter={16} justify="center" align="middle">
                                    <Col>
                                        <Statistic title="验证 mAP50" value={result.accuracy * 100} suffix="%" precision={2}
                                            valueStyle={{ color: (result.accuracy || 0) > 0.8 ? '#52c41a' : '#faad14', fontSize: 36 }} />
                                    </Col>
                                    <Col><Statistic title="模型" value={result.model_name} /></Col>
                                    <Col><Statistic title="训练轮次" value={result.epochs || '-'} /></Col>
                                    <Col><Statistic title="类别" value={result.class_names?.length || '-'} /></Col>
                                    <Col><Statistic title="运行目录" value={runName} /></Col>
                                </Row>
                                <div style={{ marginTop: 8, color: '#888', fontSize: 12 }}>
                                    结果图与更多产物经 <Tag>dataset/cscan_dataset/runs/{runName}</Tag> 提供
                                </div>
                            </Card>

                            {plotNames.length > 0 && (
                                <Card size="small" title="训练可视化" bodyStyle={{ padding: 8 }}>
                                    <Row gutter={12}>
                                        {plotNames.slice(0, 8).map(f => (
                                            <Col span={8} key={f} style={{ marginBottom: 12 }}>
                                                <Tooltip title={f}>
                                                    <img src={`${API}/cscan/train/file?run=${encodeURIComponent(runName)}&name=${encodeURIComponent(f)}`}
                                                        alt={f} style={{ width: '100%', border: '1px solid #eee', borderRadius: 6, background: '#fff' }} />
                                                </Tooltip>
                                                <div style={{ fontSize: 12, color: '#888', textAlign: 'center' }}>{f}</div>
                                            </Col>
                                        ))}
                                    </Row>
                                </Card>
                            )}
                        </>
                    )}

                    {/* ═══ 错误 ═══ */}
                    {error && (
                        <Card size="small" title="错误信息" style={{ borderColor: '#ff4d4f' }}>
                            <pre style={{ color: '#ff4d4f', whiteSpace: 'pre-wrap', fontSize: 12 }}>{error}</pre>
                        </Card>
                    )}

                    {/* ═══ 已训练模型 ═══ */}
                    <Card size="small" title="已收编 YOLO 模型（backend/cscan_models）" extra={<Button size="small" onClick={loadModels}>刷新</Button>}>
                        <Table size="small" rowKey="model_name" dataSource={models} pagination={false} locale={{ emptyText: '暂无模型' }}
                            columns={[
                                { title: '模型', dataIndex: 'model_name' },
                                { title: '类型', dataIndex: 'model_type', width: 110, render: v => <Tag color="geekblue">{v}</Tag> },
                                { title: 'mAP50', dataIndex: 'accuracy', width: 110, render: v => v != null ? `${(v * 100).toFixed(1)}%` : '-' },
                                { title: '保存时间', dataIndex: 'saved_at', width: 190 },
                                { title: '', dataIndex: 'action', width: 70, render: (_, r) => <Button size="small" danger onClick={() => handleDelete(r.model_name)}>删除</Button> },
                            ]}
                        />
                    </Card>
                </>
            )}
        </div>
    )
}
