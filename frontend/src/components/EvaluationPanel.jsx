import React, { useState, useEffect, useRef } from 'react'
import { Card, Button, Select, Upload, Input, Tag, message, Spin, Collapse, Space } from 'antd'
import { SendOutlined, UploadOutlined, RobotOutlined, UserOutlined, DownOutlined, DownloadOutlined } from '@ant-design/icons'
import ReactECharts from 'echarts-for-react'
import ReactMarkdown from 'react-markdown'
import axios from 'axios'

const DEFECT_COLORS = {
  OK: '#52c41a', Dl: '#f5222d', Db: '#fa8c16', Po: '#fadb14',
  Vo: '#722ed1', In: '#1890ff', Fb: '#13c2c2', Rs: '#2f54eb',
  Cp: '#eb2f96', Uc: '#d9d9d9'
}

const { TextArea } = Input

export default function EvaluationPanel() {
  const [models, setModels] = useState([])
  const [selectedModel, setSelectedModel] = useState(null)
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: '你好！我是复合材料智能评估助手。\n\n请上传一个 **.nde** 文件，然后告诉我你想了解什么，比如：\n\n- "是否有缺陷？"\n- "这是什么类型的缺陷？"\n- "分析一下信号特征"',
    }
  ])
  const [inputText, setInputText] = useState('')
  const [uploadedFile, setUploadedFile] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [showReportPrompt, setShowReportPrompt] = useState(false)
  const [reportInfo, setReportInfo] = useState(null)  // null | {loading, url, error}

  const msgEndRef = useRef(null)
  const inputRef = useRef(null)

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
        // 读取文件元数据
        const treeRes = await axios.get('http://127.0.0.1:8000/tree')
        const metaInfo = await extractMeta(file.name)
        setUploadedFile({
          name: file.name,
          size: file.size,
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

  // 模拟提取元数据（后续由后端提供）
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

  // 发送消息
  const handleSend = async () => {
    if (!inputText.trim() && !uploadedFile) return
    if (!uploadedFile) {
      message.warning('请先上传一个 .nde 文件')
      return
    }

    const question = inputText.trim() || '请详细分析这个文件'
    setMessages(prev => [...prev, { role: 'user', content: question }])
    setInputText('')
    setAnalyzing(true)
    setStreamingText('')

    // 模拟流式输出（后续接入后端 SSE）
    const mockAnalysis = `## 信号分析报告

### 材料与检测参数
- **纤维类型**：${uploadedFile.meta?.fiber || 'CF'}
- **基体类型**：${uploadedFile.meta?.matrix || 'EP'}
- **结构类型**：${uploadedFile.meta?.structure || 'Plate'}
- **检测方法**：${uploadedFile.meta?.method || 'WRUT'}
- **缺陷类型**：${uploadedFile.meta?.defectType || 'OK'}

### 信号特征分析
对上传的 .nde 文件进行信号处理和分析，结果如下：

- **幅值范围**：信号幅值在 -1876.5 到 +2034.2 之间
- **信号能量**：总能量约为 1.23×10⁵
- **信噪比**：估算 SNR 约 24.3 dB，信号质量良好
- **回波特征**：在采样点 300-500 区间出现明显衰减，衰减幅度约 45%
- **底波分析**：底波幅值为正常值的 62%，存在一定能量衰减

### 综合分析

根据信号特征和材料参数，该检测点的特征与 **Dl（分层）** 类型缺陷的典型模式高度吻合：

1. **回波时间提前**：分层界面的反射回波到达时间比正常区域提前约 15%，表明声波在表层附近即发生反射
2. **幅值衰减明显**：最大幅值仅为正常区域的 55%，说明存在声阻抗不连续界面
3. **底波能量降低**：底波信号强度下降至正常水平的 62%，进一步确认存在内部界面反射

**结论**：该检测点判定为 **Dl（分层）** 缺陷，置信度约 **87.3%**。

> 建议对该区域进行进一步扫描以确定分层范围。`

    // 逐字输出模拟
    let idx = 0
    const interval = setInterval(() => {
      if (idx < mockAnalysis.length) {
        setStreamingText(mockAnalysis.slice(0, idx + 1))
        idx += 1
      } else {
        clearInterval(interval)
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: mockAnalysis,
          bscan: true,
        }])
        setStreamingText('')
        setAnalyzing(false)
        setShowReportPrompt(true)
      }
    }, 30)
  }

  // 请求生成检测报告
  const requestReport = async () => {
    setReportInfo({ loading: true, url: null, error: null })
    try {
      const lastMsg = messages.filter(m => m.role === 'assistant').pop()
      const res = await axios.post('http://127.0.0.1:8000/chat/report', {
        filename: uploadedFile?.name || 'unknown.nde',
        meta: uploadedFile?.meta || {},
        signal_analysis: lastMsg?.content || '',
        defect_result: lastMsg?.content?.includes('Dl') ? 'Dl' : 'OK',
        confidence: lastMsg?.content?.includes('87.3') ? 87.3 : 0,
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
              <ReactMarkdown
                components={{
                  strong: ({ children }) => <strong style={{ color: '#333' }}>{children}</strong>,
                  code: ({ children }) => <code style={{ background: '#e6e6e6', padding: '1px 4px', borderRadius: 3, fontSize: 13 }}>{children}</code>,
                }}
              >
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
            <ReactMarkdown
              components={{
                strong: ({ children }) => <strong style={{ color: '#333' }}>{children}</strong>,
                code: ({ children }) => <code style={{ background: '#e6e6e6', padding: '1px 4px', borderRadius: 3, fontSize: 13 }}>{children}</code>,
              }}
            >
              {streamingText}
            </ReactMarkdown>
            {analyzing && <span style={{ animation: 'blink 1s infinite', marginLeft: 2 }}>▌</span>}
          </div>
        )}
      </div>
    )
  }

  // 欢迎页（无消息时）
  const showWelcome = messages.length === 1 && !uploadedFile

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: '#f5f5f5',
    }}>
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
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
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
                    if (!uploadedFile) { message.warning('请先上传文件'); return }
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
            placeholder={uploadedFile ? '输入你的问题…' : '请先上传一个 .nde 文件'}
            disabled={analyzing || !uploadedFile}
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
            <Button
              type="primary"
              icon={<SendOutlined />}
              size="large"
              onClick={handleSend}
              disabled={analyzing || !uploadedFile || !inputText.trim()}
              loading={analyzing}
              style={{ width: 48, height: 44 }}
            />
          </div>
        </div>
        <div style={{ textAlign: 'center', color: '#ccc', fontSize: 11, marginTop: 6 }}>
          按 Enter 发送，Shift+Enter 换行
        </div>
      </div>

      {/* 闪烁光标动画 */}
      <style>{`
        @keyframes blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
      `}</style>
    </div>
  )
}
