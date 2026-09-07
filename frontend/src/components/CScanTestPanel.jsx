// CScan 图像 YOLO 验证评估面板（模型测试 → 超声 CScan）
// 结构与视觉对齐 AScan TestingPanel：模型选择 / 进度 / 整体指标 / 逐类指标 / 混淆/PR/预测图预览
import React, { useState, useEffect, useRef } from 'react'
import {
    Card, Button, Progress, Statistic, Row, Col, Table, Tag, Select,
    message, Spin, Empty, Tooltip,
} from 'antd'
import axios from 'axios'

const API = 'http://127.0.0.1:8000'
const IMG_COLORS = { Dl: '#f5222d', Db: '#fa8c16', Po: '#fadb14' }

export default function CScanTestPanel({ active }) {
    const [models, setModels] = useState([])
    const [selectedModel, setSelectedModel] = useState(null)
    const [imgsz, setImgsz] = useState(640)
    const [device, setDevice] = useState('cpu')

    const [jobId, setJobId] = useState(null)
    const [status, setStatus] = useState(null)
    const [progress, setProgress] = useState(0)
    const [statusText, setStatusText] = useState('')
    const [result, setResult] = useState(null)
    const [error, setError] = useState(null)

    const pollTimer = useRef(null)
    const isRunning = ['pending', 'loading', 'testing', 'training'].includes(status)

    useEffect(() => {
        if (!active) return
        axios.get(`${API}/cscan/train/models`).then(r => setModels(r.data.models || [])).catch(() => message.error('无法加载模型列表'))
    }, [active])

    useEffect(() => {
        if (!jobId) return
        const poll = () => axios.get(`${API}/cscan/test/status/${jobId}`).then(res => {
            const s = res.data
            setStatus(s.status)
            setProgress(s.progress || 0)
            if (s.status === 'loading') setStatusText('加载模型…')
            else if (s.status === 'training' || s.status === 'testing') setStatusText('验证评估中…')
            else if (s.status === 'error') { setError(s.error); setStatusText('评估出错'); clearInterval(pollTimer.current) }
            else if (s.status === 'done') {
                setStatusText('评估完成'); clearInterval(pollTimer.current)
                axios.get(`${API}/cscan/test/result/${jobId}`).then(r => setResult(r.data)).catch(() => message.error('获取评估结果失败'))
            }
        }).catch(() => { clearInterval(pollTimer.current); setStatus('error'); setError('连接失败') })
        poll()
        pollTimer.current = setInterval(poll, 2000)
        return () => clearInterval(pollTimer.current)
    }, [jobId])

    const modelOptions = models.map(m => ({
        value: m.model_file,
        label: `${m.model_file}${m.accuracy != null ? `  (mAP50 ${(m.accuracy * 100).toFixed(1)}%)` : ''}`,
    }))

    const handleStart = () => {
        if (!selectedModel) { message.warning('请先选择一个模型'); return }
        setStatus('pending'); setProgress(0); setStatusText('排队中…'); setResult(null); setError(null)
        axios.post(`${API}/cscan/test/start`, { model_name: selectedModel, imgsz, device })
            .then(res => setJobId(res.data.job_id))
            .catch(err => { message.error('启动评估失败'); setStatus('error'); setError(err.message) })
    }
    const reset = () => { setJobId(null); setStatus(null); setProgress(0); setResult(null); setError(null); setStatusText('') }

    const o = result?.overall || {}
    const runName = result?.run_name || ''
    const perClass = result?.per_class || []
    const predImgs = (result?.plot_images || []).filter(f => f.includes('_pred') || f.includes('confusion') || f.includes('PR_curve'))
    const plots = result?.plot_images || []

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 12, overflow: 'auto', paddingRight: 4 }}>
            {/* ═══ 模型选择 ═══ */}
            <Card size="small" title="模型选择">
                <Row gutter={16} align="middle">
                    <Col span={14}>
                        <Select placeholder="选择要评估的 YOLO 模型" value={selectedModel} onChange={setSelectedModel}
                            style={{ width: '100%' }} disabled={isRunning} showSearch optionFilterProp="label"
                            options={modelOptions}
                            notFoundContent={models.length === 0 ? <Empty description="暂无模型（先去模型训练-超声CScan 训练）" /> : null} />
                    </Col>
                    <Col span={2}><div style={{ marginBottom: 4, color: '#999', fontSize: 12 }}>imgsz</div>
                        <Select value={imgsz} onChange={setImgsz} style={{ width: '100%' }} disabled={isRunning}
                            options={[320, 640, 1280].map(v => ({ value: v, label: `${v}` }))} /></Col>
                    <Col span={2}><div style={{ marginBottom: 4, color: '#999', fontSize: 12 }}>device</div>
                        <Select value={device} onChange={setDevice} style={{ width: '100%' }} disabled={isRunning}
                            options={[{ value: 'cpu', label: 'CPU' }, { value: '0', label: 'GPU(0)' }]} /></Col>
                    <Col span={3}><Button type="primary" block size="large" onClick={handleStart}
                        disabled={isRunning || !selectedModel} loading={isRunning}>
                        {isRunning ? '评估中…' : '开始评估'}</Button></Col>
                    <Col span={3}><Button block size="large" onClick={reset} disabled={!result && status !== 'error'}>重置</Button></Col>
                </Row>
                <div style={{ marginTop: 6, color: '#888', fontSize: 12 }}>
                    在 <b>验证集</b>（当前 val.txt）上跑 ultralytics val，给出 mAP50/mAP50-95/精度/召回与混淆/PR 图。
                </div>
            </Card>

            {/* ═══ 进度 ═══ */}
            {status && (
                <Card size="small">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                        <Progress percent={progress} status={status === 'error' ? 'exception' : 'active'}
                            strokeColor={status === 'done' ? '#52c41a' : undefined} style={{ flex: 1, margin: 0 }} />
                        <span style={{ color: '#999', whiteSpace: 'nowrap', fontSize: 13 }}>
                            {statusText}{status === 'done' && ' ✅'}{status === 'error' && ' ❌'}
                        </span>
                    </div>
                </Card>
            )}

            {/* ═══ 结果 ═══ */}
            {result && (
                <>
                    <Card size="small">
                        <Row gutter={16} justify="center" align="middle">
                            <Col><Statistic title="mAP50" value={(o.mAP50 || 0) * 100} suffix="%" precision={2}
                                valueStyle={{ color: (o.mAP50 || 0) > 0.8 ? '#52c41a' : '#faad14', fontSize: 36 }} /></Col>
                            <Col><Statistic title="mAP50-95" value={(o.mAP50_95 || 0) * 100} suffix="%" precision={2} /></Col>
                            <Col><Statistic title="精度 P" value={(o.P || 0) * 100} suffix="%" precision={2} /></Col>
                            <Col><Statistic title="召回 R" value={(o.R || 0) * 100} suffix="%" precision={2} /></Col>
                            <Col><Statistic title="模型" value={result.model_name} /></Col>
                        </Row>
                    </Card>

                    <Row gutter={12}>
                        <Col span={12}>
                            <Card size="small" title="逐类 mAP50-95" bodyStyle={{ padding: 0 }}>
                                <Table size="small" rowKey="name" dataSource={perClass} pagination={false} locale={{ emptyText: '-' }}
                                    columns={[
                                        { title: '类别', dataIndex: 'name', render: (v) => <Tag color={IMG_COLORS[v] || '#888'}>{v}-{perClass.find(p => p.name === v)?.zh || ''}</Tag> },
                                        { title: 'mAP50-95', dataIndex: 'mAP50_95', width: 140, render: v => v != null ? `${(v * 100).toFixed(1)}%` : '-' },
                                    ]} />
                            </Card>
                        </Col>
                        <Col span={12}>
                            <Card size="small" title="评估说明">
                                <div style={{ color: '#666', fontSize: 13, lineHeight: 1.8 }}>
                                    验证样本：当前 val 划分。混淆矩阵/PR 曲线与抽样预测图在下方；
                                    预测图里绿色为标签框、色块为预测框（ultralytics val 出图）。
                                </div>
                            </Card>
                        </Col>
                    </Row>

                    {plots.length > 0 && (
                        <Card size="small" title="可视化（混淆矩阵 / PR / 抽样预测）" bodyStyle={{ padding: 8 }}>
                            <Row gutter={12}>
                                {plots.slice(0, 8).map(f => (
                                    <Col span={8} key={f} style={{ marginBottom: 12 }}>
                                        <Tooltip title={f}>
                                            <img src={`${API}/cscan/train/file?run=${encodeURIComponent(runName)}&name=${encodeURIComponent(f)}`}
                                                alt={f} style={{ width: '100%', border: '1px solid #eee', borderRadius: 6, background: '#fff' }} />
                                        </Tooltip>
                                        <div style={{ fontSize: 12, color: '#888', textAlign: 'center' }}>{f}</div>
                                    </Col>
                                ))}
                            </Row>
                            {predImgs.length === 0 && <div style={{ color: '#bbb', fontSize: 12 }}>未生成预测预览图（可选 conf 参数后续开放）</div>}
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
        </div>
    )
}
