import React, { useState, useEffect, useRef } from 'react'
import { Button, Select, Upload, Input, Tag, message, Spin, Collapse, Segmented } from 'antd'
import { SendOutlined, UploadOutlined, RobotOutlined, UserOutlined, DownloadOutlined, StopOutlined } from '@ant-design/icons'
import ReactECharts from 'echarts-for-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import axios from 'axios'
import AScanPlayer from './AScanPlayer'

const DEFECT_COLORS = {
    OK: '#52c41a', Dl: '#f5222d', Db: '#fa8c16', Po: '#fadb14',
    Vo: '#722ed1', In: '#1890ff', Fb: '#13c2c2', Rs: '#2f54eb',
    Cp: '#eb2f96', Uc: '#d9d9d9'
}

const { TextArea } = Input

// 共享 Markdown 组件样式
const markdownComponents = {
    strong: ({ children }) => <strong style={{ color: '#333' }}>{children}</strong>,
    code: ({ children }) => <code style={{ background: '#e6e6e6', padding: '1px 4px', borderRadius: 3, fontSize: 13 }}>{children}</code>,
    table: ({ children }) => (
        <table style={{ borderCollapse: 'collapse', width: '100%', margin: '8px 0', fontSize: 13 }}>
            {children}
        </table>
    ),
    thead: ({ children }) => <thead style={{ background: '#fafafa' }}>{children}</thead>,
    th: ({ children }) => (
        <th style={{ border: '1px solid #d9d9d9', padding: '6px 10px', fontWeight: 'bold', textAlign: 'center' }}>
            {children}
        </th>
    ),
    td: ({ children }) => (
        <td style={{ border: '1px solid #d9d9d9', padding: '4px 10px', textAlign: 'center' }}>
            {children}
        </td>
    ),
}

export default function EvaluationPanel({ cscanContext = null, prefill = '' }) {
    const [models, setModels] = useState([])
    const [selectedModel, setSelectedModel] = useState(null)
    const [aiMode, setAiMode] = useState('cloud')  // 'cloud' | 'local'
    const [messages, setMessages] = useState([])
    const [inputText, setInputText] = useState('')
    const [uploadedFile, setUploadedFile] = useState(null)
    const [analyzing, setAnalyzing] = useState(false)
    const [streamingText, setStreamingText] = useState('')
    const [showReportPrompt, setShowReportPrompt] = useState(false)
    const [reportInfo, setReportInfo] = useState(null)  // null | {loading, url, error}
    const [signalWaveform, setSignalWaveform] = useState(null)  // {bscan, abnormal_frames, ...}

    // 争议项
    const [showDisputePrompt, setShowDisputePrompt] = useState(false)
    const [disputeInfo, setDisputeInfo] = useState(null)  // null | {loading, id, error}
    const [disputeEvidenceFile, setDisputeEvidenceFile] = useState(null)
    const [disputeDescription, setDisputeDescription] = useState('')

    // 委托单上传
    const [showDispatchPrompt, setShowDispatchPrompt] = useState(false)
    const [dispatchUploading, setDispatchUploading] = useState(false)
    const [dispatchFile, setDispatchFile] = useState(null)
    const [dispatchFields, setDispatchFields] = useState(null)
    const [dispatchDone, setDispatchDone] = useState(false)

    const msgEndRef = useRef(null)
    const inputRef = useRef(null)
    const abortRef = useRef(null)

    // CScan 面板切过来时的预填问题：自动填入输入框并聚焦
    useEffect(() => {
        if (prefill && !inputText) {
            setInputText(prefill)
            setTimeout(() => inputRef.current?.focus(), 100)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [prefill])

    // 拖拽上传状态
    const [dragOver, setDragOver] = useState(false)
    const handleDragOver = (e) => { e.preventDefault(); e.stopPropagation(); setDragOver(true) }
    const handleDragLeave = (e) => { e.preventDefault(); e.stopPropagation(); setDragOver(false) }
    const handleDrop = (e) => {
        e.preventDefault(); e.stopPropagation(); setDragOver(false)
        const files = e.dataTransfer?.files
        if (files && files.length > 0) {
            const file = files[0]
            if (file.name.endsWith('.nde') || file.name.endsWith('.h5') || file.name.endsWith('.hdf5')) {
                setDragOver(false)
                handleUpload(file)
            } else {
                message.warning('请拖入 .nde / .h5 / .hdf5 文件')
            }
        }
    }

    // 停止回复
    const handleStop = () => {
        if (abortRef.current) {
            abortRef.current.abort()
            abortRef.current = null
        }
        setAnalyzing(false)
        setStreamingText('')
    }

    // 自动滚动到底部
    useEffect(() => {
        msgEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages, streamingText])

    // 加载模型列表
    useEffect(() => {
        axios.get('http://127.0.0.1:8000/train/models')
            .then(res => {
                const list = res.data.models || []
                setModels(list)
                // 默认选择准确率最高的模型
                if (list.length > 0) {
                    const best = list.reduce((a, b) => (a.accuracy || 0) > (b.accuracy || 0) ? a : b)
                    setSelectedModel(best.model_name)
                }
            })
            .catch(() => {/* 默认为空 */})
    }, [])

    // 模型选择
    const curModel = models.find(m => m.model_name === selectedModel)

    // 上传文件
    const handleUpload = async (file) => {
        const form = new FormData()
        form.append('file', file)

        try {
            const res = await axios.post('http://127.0.0.1:8000/upload', form)
            if (res.data) {
                const metaInfo = await extractMeta(file.name)
                setSignalWaveform(null)
                setShowDisputePrompt(false)
                setDisputeInfo(null)
                setShowDispatchPrompt(false)
                setDispatchDone(false)
                setDispatchFile(null)
                setDispatchFields(null)
                setUploadedFile({
                    name: file.name,
                    size: file.size,
                    path: res.data.file_path,
                    meta: metaInfo,
                })
                setMessages(prev => [
                    ...prev,
                    {
                        role: 'user',
                        content: '',
                        file: { name: file.name, meta: metaInfo },
                    }
                ])
                message.success(`已上传: ${file.name}`)
            }
        } catch (err) {
            message.error('上传失败: ' + (err.response?.data?.detail || err.message))
        }
        return false
    }

    // 从文件名解析元数据
    const extractMeta = async (filename) => {
        try {
            const parts = filename.replace('.nde', '').split('_')
            return {
                fiber: parts[0] || '-',
                matrix: parts[1] || '-',
                structure: parts[2] || '-',
                method: parts[3] || '-',
                defectType: parts[4] || '-',
            }
        } catch {
            return null
        }
    }
    // 读取流式文本（后端 StreamingResponse text/plain）
    const readStream = async (reader, decoder, onText, onDone) => {
        let fullText = ''

        while (true) {
            const { done, value } = await reader.read()
            if (done) break

            const chunk = decoder.decode(value, { stream: true })
            fullText += chunk

            // 检查结束标记
            const doneIdx = fullText.indexOf('\n__DONE__')
            if (doneIdx !== -1) {
                const textBeforeDone = fullText.slice(0, doneIdx)
                if (textBeforeDone) onText(textBeforeDone)
                onDone(textBeforeDone)
                return
            }

            if (chunk) onText(fullText)
        }
        onDone(fullText)
    }

    // 发送消息
    const handleSend = async () => {
        if (!inputText.trim()) return

        const question = inputText.trim()

        // 检测是否在索要检测报告
        const wantsReport = /^(需要|要|开|出具|生成)(一份|一个)?(检测)?报告/.test(question) ||
                                                /报告/.test(question)

        if (wantsReport && uploadedFile) {
            setMessages(prev => [...prev, { role: 'user', content: question }])
            setInputText('')
            if (dispatchDone) {
                // 委托单已上传，直接显示报告按钮
                setShowReportPrompt(true)
                setReportInfo(null)
            } else {
                // 没有委托单，引导上传
                setShowDispatchPrompt(true)
                setDispatchFile(null)
                setDispatchFields(null)
                setShowReportPrompt(false)
            }
            return
        }

        setMessages(prev => [...prev, { role: 'user', content: question }])
        setInputText('')
        setAnalyzing(true)
        setStreamingText('')
        setShowReportPrompt(false)
        setReportInfo(null)
        setShowDisputePrompt(false)
        setDisputeInfo(null)
        setShowDispatchPrompt(false)
        setDispatchFile(null)
        setDispatchFields(null)
        setDispatchDone(false)
        setSignalWaveform(null)

        // 创建 AbortController
        const controller = new AbortController()
        abortRef.current = controller

        // 构建多轮对话历史（只含文本消息，保留最近 40 条）
        const chatHistory = messages
            .filter(m => m.content && m.content.trim())
            .slice(-40)
            .map(m => ({ role: m.role, content: m.content }))
        chatHistory.push({ role: 'user', content: question })

        try {
            const response = await fetch('http://127.0.0.1:8000/chat/ask', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal,
                body: JSON.stringify({
                    question,
                    history: chatHistory,
                    model_name: selectedModel || '',
                    ai_mode: aiMode,
                    ...(cscanContext ? { cscan_context: cscanContext } : {}),
                }),
            })

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`)
            }

            const reader = response.body.getReader()
            const decoder = new TextDecoder()

            await readStream(
                reader,
                decoder,
                (text) => {
                    setStreamingText(text)
                },
                (finalText) => {
                    setMessages(prev => [...prev, {
                        role: 'assistant',
                        content: finalText,
                    }])
                    setStreamingText('')
                    setAnalyzing(false)
                    // 仅当问题涉及信号/波形/缺陷分析时才拉取 A-Scan 波形数据
                    const ascanKeywords = ['波形', '信号', 'ascan', 'a扫', 'a-scan', 'b扫', 'bscan', 'b-scan',
                        '缺陷', '分析', '查看', '显示', '异常', '幅值', '衰减', '底波',
                        '回波', '能量', '信噪比', 'snr', '帧', '检测结果', '评估']
                    const isAscanRelevant = ascanKeywords.some(k => question.toLowerCase().includes(k))
                    if (uploadedFile && isAscanRelevant) {
                        axios.get('http://127.0.0.1:8000/chat/signal_waveform')
                            .then(res => {
                                if (res.data && res.data.bscan) {
                                    setSignalWaveform(res.data)
                                }
                            })
                            .catch(() => {})
                    }
                    // 检测用户是否在质疑模型判断（争议项登记逻辑）
                    const userDisputeKeywords = ['不对', '不是', '应该', '错了', '质疑', '不同意', '有异议', '改正', '改成', '改为', '变更为', '不认同', '误判', '判错了']
                    const userDisagree = userDisputeKeywords.some(k => question.toLowerCase().includes(k))
                    // 仅当用户明确质疑 + AI回复提到争议时，才弹出争议项登记
                    const aiDisputeKeywords = ['争议项', '上传证据', '仲裁']
                    const aiMentionsDispute = aiDisputeKeywords.some(k => (finalText || '').includes(k))
                    if (userDisagree && aiMentionsDispute && uploadedFile) {
                        setShowDisputePrompt(true)
                        setDisputeInfo(null)
                        setDisputeEvidenceFile(null)
                        setDisputeDescription('')
                    } else {
                        setShowDisputePrompt(false)
                    }
                }
            )
        } catch (err) {
            if (err.name === 'AbortError') {
                // 用户主动停止，不显示错误
            } else {
                setStreamingText(prev => prev + `\n\n⚠️ 请求出错: ${err.message}`)
            }
            setAnalyzing(false)
        }
    }

    // 从 AI 回复中提取缺陷类型
    const extractDefectType = (text) => {
        // 常见的缺陷类型标记
        const defectTypes = ['Dl', 'Db', 'Po', 'Vo', 'In', 'Fb', 'Rs', 'Uc', 'OK', 'Cp']
        for (const dt of defectTypes) {
            if (text.includes(`**${dt}**`) || text.includes(dt + '（') || text.includes(dt + '(')) {
                return dt
            }
        }
        return 'OK'
    }

    // 从 AI 回复中提取置信度
    const extractConfidence = (text) => {
        const match = text.match(/(\d+\.?\d*)\s*[%％]/)
        if (match) {
            const val = parseFloat(match[1])
            return val > 1 ? val : val * 100  // 处理 87.3% 或 0.873 两种格式
        }
        return 0
    }

    // 请求生成检测报告
    const requestReport = async () => {
        setReportInfo({ loading: true, url: null, error: null })
        try {
            const lastMsg = messages.filter(m => m.role === 'assistant').pop()
            const content = lastMsg?.content || ''
            const res = await axios.post('http://127.0.0.1:8000/chat/report', {
                filename: uploadedFile?.name || 'unknown.nde',
                meta: uploadedFile?.meta || {},
                signal_analysis: content,
                defect_result: extractDefectType(content),
                confidence: extractConfidence(content),
                model_name: selectedModel || '',
            })
            if (res.data.success) {
                setReportInfo({ loading: false, url: res.data.download_url, error: null })
                message.success('检测报告生成成功')
            } else {
                setReportInfo({ loading: false, url: null, error: res.data.error })
                message.error('生成报告失败: ' + res.data.error)
            }
        } catch (err) {
            setReportInfo({ loading: false, url: null, error: err.message })
            message.error('生成报告失败: ' + err.message)
        }
    }

    // 上传委托单
    const handleDispatchUpload = async () => {
        if (!dispatchFile) return
        setDispatchUploading(true)
        try {
            const form = new FormData()
            form.append('file', dispatchFile)
            const res = await axios.post('http://127.0.0.1:8000/dispatch/upload', form)
            if (res.data.success) {
                setDispatchFields(res.data.fields)
                setDispatchDone(true)
                setShowDispatchPrompt(false)
                setShowReportPrompt(true)
                setReportInfo(null)
                message.success('委托单解析成功，可生成检测报告')
            } else {
                message.error('委托单解析失败: ' + (res.data.error || ''))
            }
        } catch (err) {
            message.error('委托单上传失败: ' + err.message)
        }
        setDispatchUploading(false)
    }

    // 提交争议项
    const submitDispute = async () => {
        setDisputeInfo({ loading: true, id: null, error: null })
        try {
            const lastMsg = messages.filter(m => m.role === 'assistant').pop()
            const form = new FormData()
            form.append('original_file', uploadedFile?.name || 'unknown.nde')
            form.append('original_prediction', extractDefectType(lastMsg?.content || ''))
            form.append('user_claim', disputeDescription.slice(0, 50))
            form.append('description', disputeDescription)
            if (disputeEvidenceFile) {
                form.append('file', disputeEvidenceFile)
            }
            const res = await axios.post('http://127.0.0.1:8000/dispute/submit', form)
            if (res.data.success) {
                setDisputeInfo({ loading: false, id: res.data.dispute_id, error: null })
                message.success(`争议项已登记：${res.data.dispute_id}`)
            } else {
                setDisputeInfo({ loading: false, id: null, error: res.data.error })
                message.error('争议项登记失败')
            }
        } catch (err) {
            setDisputeInfo({ loading: false, id: null, error: err.message })
            message.error('争议项登记失败: ' + err.message)
        }
    }

    // 模拟 B-scan 热力图数据
    const mockBscanOption = {
        animation: false,
        grid: { top: 5, bottom: 5, left: 5, right: 5 },
        xAxis: { type: 'category', show: false, data: Array.from({ length: 250 }, (_, i) => i) },
        yAxis: { type: 'category', show: false, data: Array.from({ length: 64 }, (_, i) => i) },
        visualMap: { show: false, inRange: { color: ['#1a1a2e', '#16213e', '#0f3460', '#e94560'] } },
        series: [{
            type: 'heatmap',
            progressive: 5000,
            data: Array.from({ length: 64 }, (_, y) =>
                Array.from({ length: 250 }, (_, x) => [x, y, Math.sin(x / 20) * Math.cos(y / 8) * 1500 + (Math.random() - 0.5) * 400])
            ).flat(),
        }]
    }

    // 消息渲染
    const renderMessage = (msg, idx) => {
        const isUser = msg.role === 'user'

        return (
            <div key={idx} style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: isUser ? 'flex-end' : 'flex-start',
                marginBottom: 20,
            }}>
                {/* 角色标识 */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginBottom: 6,
                    flexDirection: isUser ? 'row-reverse' : 'row',
                }}>
                    <div style={{
                        width: 32, height: 32, borderRadius: '50%',
                        background: isUser ? '#1890ff' : '#52c41a',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#fff', fontSize: 14,
                    }}>
                        {isUser ? <UserOutlined /> : <RobotOutlined />}
                    </div>
                    <span style={{ color: '#999', fontSize: 12 }}>
                        {isUser ? '你' : '智能评估助手'}
                    </span>
                </div>

                {/* 文件上传消息 */}
                {msg.file && (
                    <div style={{
                        maxWidth: '80%',
                        background: '#e6f7ff',
                        border: '1px solid #91d5ff',
                        borderRadius: 12,
                        padding: '12px 16px',
                    }}>
                        <div style={{ fontWeight: 'bold', marginBottom: 4 }}>📎 {msg.file.name}</div>
                        {msg.file.meta && (
                            <div style={{ fontSize: 13, color: '#666', lineHeight: 1.8 }}>
                                <Tag color="blue">{msg.file.meta.fiber}</Tag>
                                <Tag color="cyan">{msg.file.meta.matrix}</Tag>
                                <Tag color="geekblue">{msg.file.meta.structure}</Tag>
                                <Tag color="purple">{msg.file.meta.method}</Tag>
                                <Tag color={DEFECT_COLORS[msg.file.meta.defectType] || '#888'}>{msg.file.meta.defectType}</Tag>
                            </div>
                        )}
                    </div>
                )}

                {/* 用户文本（纯文本） / 助手文本（Markdown） */}
                {msg.content && (
                    <div style={{
                        maxWidth: '80%',
                        background: isUser ? '#1890ff' : '#f0f0f0',
                        color: isUser ? '#fff' : '#333',
                        borderRadius: 12,
                        borderBottomRightRadius: isUser ? 4 : 12,
                        borderBottomLeftRadius: isUser ? 12 : 4,
                        padding: '12px 16px',
                        fontSize: 14,
                        lineHeight: 1.8,
                    }}>
                        {isUser ? (
                            msg.content
                        ) : (
                            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                                {msg.content}
                            </ReactMarkdown>
                        )}
                    </div>
                )}

                {/* B-scan 可展开缩略图 */}
                {msg.bscan && (
                    <Collapse
                        ghost
                        size="small"
                        items={[{
                            key: 'bscan',
                            label: <span style={{ color: '#1890ff', fontSize: 13 }}>👁️ 查看 B-Scan 热力图</span>,
                            children: (
                                <ReactECharts option={mockBscanOption} style={{ height: 200, width: 500 }} />
                            ),
                        }]}
                        style={{ maxWidth: 550, marginTop: 8 }}
                    />
                )}

                {/* A-Scan 波形播放器：只有最新一条助手消息显示 */}
                {!isUser && signalWaveform?.bscan && idx === messages.length - 1 && (
                    <Collapse
                        ghost
                        size="small"
                        defaultActiveKey={['waveform']}
                        items={[{
                            key: 'waveform',
                            label: <span style={{ color: '#f5222d', fontSize: 13 }}>📈 查看 A-Scan 波形（异常帧红色标注）</span>,
                            children: (
                                <AScanPlayer
                                    bscan={signalWaveform.bscan}
                                    abnormalFrames={signalWaveform.abnormal_frames || signalWaveform.abnormal_indices || []}
                                    abnormalZones={signalWaveform.abnormal_zone_positions || []}
                                    keypoints={signalWaveform.keypoints || []}
                                />
                            ),
                        }]}
                        style={{ maxWidth: 550, marginTop: 4 }}
                    />
                )}
            </div>
        )
    }

    // 流式消息渲染
    const renderStreamingMsg = () => {
        if (!streamingText && !analyzing) return null
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <div style={{
                        width: 32, height: 32, borderRadius: '50%',
                        background: '#52c41a',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#fff', fontSize: 14,
                    }}>
                        <RobotOutlined />
                    </div>
                    <span style={{ color: '#999', fontSize: 12 }}>智能评估助手</span>
                    {analyzing && <Spin size="small" style={{ marginLeft: 4 }} />}
                </div>
                {streamingText && (
                    <div style={{
                        maxWidth: '80%',
                        background: '#f0f0f0',
                        color: '#333',
                        borderRadius: 12,
                        borderBottomLeftRadius: 4,
                        padding: '12px 16px',
                        fontSize: 14,
                        lineHeight: 1.8,
                    }}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                            {streamingText}
                        </ReactMarkdown>
                        {analyzing && <span style={{ animation: 'blink 1s infinite', marginLeft: 2 }}>▌</span>}
                    </div>
                )}
            </div>
        )
    }

    // 欢迎页（无消息时）
    const showWelcome = messages.length === 0 && !uploadedFile

    return (
        <div
            style={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                background: dragOver ? '#e6f7ff' : '#f5f5f5',
                border: dragOver ? '2px dashed #1890ff' : '2px solid transparent',
                boxSizing: 'border-box',
                transition: 'all 0.2s',
            }}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            {/* ═══ Header ═══ */}
            <div style={{
                padding: '12px 20px',
                background: '#fff',
                borderBottom: '1px solid #e8e8e8',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexShrink: 0,
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <RobotOutlined style={{ fontSize: 22, color: '#52c41a' }} />
                    <span style={{ fontSize: 16, fontWeight: 'bold' }}>复合材料智能评估</span>
                    {cscanContext && (
                        <Tag color="geekblue" style={{ marginLeft: 4 }}>📎 C扫上下文已接入</Tag>
                    )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Segmented
                        value={aiMode}
                        onChange={setAiMode}
                        size="small"
                        options={[
                            { value: 'cloud', label: '☁️ 云端模型' },
                            { value: 'local', label: '💻 本地模型' },
                        ]}
                    />
                    <span style={{ fontSize: 13, color: '#666', whiteSpace: 'nowrap' }}>模型选择：</span>
                    <Select
                        value={selectedModel}
                        onChange={setSelectedModel}
                        style={{ width: 260 }}
                        size="small"
                        disabled={analyzing || models.length === 0}
                        placeholder="选择评估模型"
                        options={models.map(m => ({
                            value: m.model_name,
                            label: `${m.model_name}  (${(m.accuracy * 100).toFixed(1)}%)`,
                        }))}
                    />
                </div>
            </div>

            {/* ═══ 消息区域 ═══ */}
            <div style={{
                flex: 1,
                overflow: 'auto',
                padding: '20px 10%',
                position: 'relative',
            }}>
                {/* 欢迎页：DeepSeek 风格 */}
                {showWelcome && (
                    <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        height: '100%',
                        color: '#bbb',
                    }}>
                        <RobotOutlined style={{ fontSize: 64, color: '#e8e8e8', marginBottom: 16 }} />
                        <div style={{ fontSize: 18, fontWeight: 'bold', color: '#999', marginBottom: 8 }}>
                            复合材料智能评估助手
                        </div>
                        <div style={{ fontSize: 14, color: '#bbb', marginBottom: 24, textAlign: 'center' }}>
                            上传 .nde 文件，我可以帮你分析缺陷类型和信号特征
                        </div>
                        <div style={{
                            display: 'flex',
                            gap: 12,
                            flexWrap: 'wrap',
                            justifyContent: 'center',
                        }}>
                            {['是否有缺陷？', '这是什么类型的缺陷？', '分析一下信号特征', '与正常区域对比'].map(text => (
                                <Tag
                                    key={text}
                                    style={{
                                        cursor: 'pointer', padding: '6px 14px', fontSize: 13, borderRadius: 20,
                                        background: '#f0f0f0', border: '1px solid #d9d9d9', color: '#666',
                                    }}
                                    onClick={() => {
                                        setInputText(text)
                                        setTimeout(() => inputRef.current?.focus(), 100)
                                    }}
                                >
                                    {text}
                                </Tag>
                            ))}
                        </div>
                    </div>
                )}

                {!showWelcome && (
                    <>
                        {messages.map((msg, idx) => renderMessage(msg, idx))}
                        {renderStreamingMsg()}

                        {/* 检测报告提示 */}
                        {showReportPrompt && !analyzing && (
                            <div style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'flex-start',
                                marginBottom: 20,
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                    <div style={{
                                        width: 32, height: 32, borderRadius: '50%',
                                        background: '#52c41a',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        color: '#fff', fontSize: 14,
                                    }}>
                                        <RobotOutlined />
                                    </div>
                                    <span style={{ color: '#999', fontSize: 12 }}>智能评估助手</span>
                                </div>
                                <div style={{
                                    background: '#f0f0f0',
                                    borderRadius: 12,
                                    borderBottomLeftRadius: 4,
                                    padding: '16px 20px',
                                    fontSize: 14,
                                }}>
                                    <div style={{ marginBottom: 12 }}>是否需要为您开具检测报告？</div>
                                    <div style={{ display: 'flex', gap: 10 }}>
                                        {!reportInfo?.url ? (
                                            <>
                                                <Button
                                                    type="primary"
                                                    size="small"
                                                    loading={reportInfo?.loading}
                                                    onClick={requestReport}
                                                >
                                                    需要
                                                </Button>
                                                <Button
                                                    size="small"
                                                    onClick={() => setShowReportPrompt(false)}
                                                >
                                                    不需要
                                                </Button>
                                            </>
                                        ) : (
                                            <Button
                                                type="primary"
                                                icon={<DownloadOutlined />}
                                                href={`http://127.0.0.1:8000${reportInfo.url}`}
                                                target="_blank"
                                            >
                                                下载检测报告
                                            </Button>
                                        )}
                                        {reportInfo?.error && (
                                            <span style={{ color: '#f5222d', fontSize: 12, marginLeft: 8 }}>
                                                生成失败: {reportInfo.error}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* 争议项证据上传 */}
                        {showDisputePrompt && !analyzing && (
                            <div style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'flex-start',
                                marginBottom: 20,
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                    <div style={{
                                        width: 32, height: 32, borderRadius: '50%',
                                        background: '#fa8c16',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        color: '#fff', fontSize: 14,
                                    }}>
                                        ⚖
                                    </div>
                                    <span style={{ color: '#999', fontSize: 12 }}>争议项登记</span>
                                </div>
                                <div style={{
                                    background: '#fff7e6',
                                    border: '1px solid #ffd591',
                                    borderRadius: 12,
                                    borderBottomLeftRadius: 4,
                                    padding: '16px 20px',
                                    fontSize: 14,
                                    width: '100%',
                                    maxWidth: 500,
                                }}>
                                    <div style={{ marginBottom: 10, color: '#d46b08' }}>
                                        📋 如您对模型判断有异议，请上传证据材料，系统将登记为争议项保留备查
                                    </div>
                                    <div style={{ marginBottom: 10 }}>
                                        <Upload
                                            accept=".zip"
                                            beforeUpload={(file) => { setDisputeEvidenceFile(file); return false }}
                                            showUploadList={false}
                                        >
                                            <Button icon={<UploadOutlined />} size="small">
                                                {disputeEvidenceFile ? disputeEvidenceFile.name : '选择证据 ZIP 文件'}
                                            </Button>
                                        </Upload>
                                        {disputeEvidenceFile && (
                                            <Tag closable onClose={() => setDisputeEvidenceFile(null)} style={{ marginTop: 4 }}>
                                                {disputeEvidenceFile.name}
                                            </Tag>
                                        )}
                                    </div>
                                    <div style={{ marginBottom: 10 }}>
                                        <Input.TextArea
                                            placeholder="请描述您认为的正确缺陷类型及依据…"
                                            value={disputeDescription}
                                            onChange={e => setDisputeDescription(e.target.value)}
                                            rows={3}
                                            style={{ fontSize: 13 }}
                                        />
                                    </div>
                                    <div style={{ display: 'flex', gap: 10 }}>
                                        <Button
                                            type="primary"
                                            size="small"
                                            loading={disputeInfo?.loading}
                                            disabled={!disputeDescription.trim()}
                                            onClick={submitDispute}
                                            style={{ background: '#d46b08', borderColor: '#d46b08' }}
                                        >
                                            提交争议项
                                        </Button>
                                        <Button size="small" onClick={() => setShowDisputePrompt(false)}>
                                            关闭
                                        </Button>
                                    </div>
                                    {disputeInfo?.id && (
                                        <div style={{ marginTop: 8, color: '#52c41a', fontSize: 13 }}>
                                            ✅ 争议项已登记，编号：<strong>{disputeInfo.id}</strong>
                                        </div>
                                    )}
                                    {disputeInfo?.error && (
                                        <div style={{ marginTop: 8, color: '#f5222d', fontSize: 13 }}>
                                            ❌ 登记失败：{disputeInfo.error}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* 委托单上传 */}
                        {showDispatchPrompt && !analyzing && (
                            <div style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'flex-start',
                                marginBottom: 20,
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                    <div style={{
                                        width: 32, height: 32, borderRadius: '50%',
                                        background: '#1890ff',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        color: '#fff', fontSize: 14,
                                    }}>
                                        📋
                                    </div>
                                    <span style={{ color: '#999', fontSize: 12 }}>委托单上传</span>
                                </div>
                                <div style={{
                                    background: '#e6f7ff',
                                    border: '1px solid #91d5ff',
                                    borderRadius: 12,
                                    borderBottomLeftRadius: 4,
                                    padding: '16px 20px',
                                    fontSize: 14,
                                    width: '100%',
                                    maxWidth: 500,
                                }}>
                                    <div style={{ marginBottom: 10, color: '#1890ff' }}>
                                        📄 请上传填写好的委托单（.doc/.docx格式），系统将根据委托单信息生成超声检测报告
                                    </div>
                                    <Upload
                                        accept=".doc,.docx"
                                        beforeUpload={(f) => { setDispatchFile(f); return false }}
                                        showUploadList={false}
                                    >
                                        <Button icon={<UploadOutlined />} size="small">
                                            {dispatchFile ? dispatchFile.name : '选择委托单文件'}
                                        </Button>
                                    </Upload>
                                    {dispatchFile && (
                                        <div style={{ marginTop: 8, display: 'flex', gap: 10 }}>
                                            <Button type="primary" size="small" loading={dispatchUploading} onClick={handleDispatchUpload}>
                                                上传并解析
                                            </Button>
                                            <Button size="small" onClick={() => { setShowDispatchPrompt(false); setDispatchFile(null) }}>
                                                取消
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        <div ref={msgEndRef} />
                    </>
                )}
            </div>

            {/* ═══ 输入区域 ═══ */}
            <div style={{
                padding: '12px 10% 20px',
                background: '#fff',
                borderTop: '1px solid #e8e8e8',
                flexShrink: 0,
            }}>
                <div style={{
                    display: 'flex',
                    gap: 12,
                    alignItems: 'flex-end',
                }}>
                    <TextArea
                        ref={inputRef}
                        value={inputText}
                        onChange={e => setInputText(e.target.value)}
                        onPressEnter={e => {
                            if (!e.shiftKey) {
                                e.preventDefault()
                                handleSend()
                            }
                        }}
                        placeholder={'输入你的问题，或上传 .nde 文件进行分析…'}
                        disabled={analyzing}
                        rows={4}
                        autoSize={{ minRows: 4, maxRows: 8 }}
                        style={{
                            flex: 1,
                            borderRadius: 8,
                            fontSize: 14,
                        }}
                    />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
                        <Upload
                            accept=".nde,.h5,.hdf5"
                            beforeUpload={handleUpload}
                            showUploadList={false}
                        >
                            <Button
                                icon={<UploadOutlined />}
                                size="large"
                                disabled={analyzing}
                                style={{ width: 48, height: 44 }}
                            />
                        </Upload>
                        {analyzing ? (
                            <Button
                                icon={<StopOutlined style={{ fontSize: 16, color: '#666' }} />}
                                size="large"
                                onClick={handleStop}
                                className="btn-stop"
                                style={{ width: 48, height: 44 }}
                            />
                        ) : (
                            <Button
                                type="primary"
                                icon={<SendOutlined />}
                                size="large"
                                onClick={handleSend}
                                disabled={!inputText.trim()}
                                style={{ width: 48, height: 44 }}
                            />
                        )}
                    </div>
                </div>
                <div style={{ textAlign: 'center', color: '#ccc', fontSize: 11, marginTop: 6 }}>
                    按 Enter 发送，Shift+Enter 换行
                </div>
            </div>

            {/* 闪烁光标动画 + 停止按钮样式 */}
            <style>{`
                @keyframes blink {
                    0%, 50% { opacity: 1; }
                    51%, 100% { opacity: 0; }
                }
                .btn-stop, .btn-stop:hover, .btn-stop:focus, .btn-stop:active {
                    color: #666 !important;
                    border-color: #d9d9d9 !important;
                    box-shadow: none !important;
                }
            `}</style>

        </div>
    )
}
