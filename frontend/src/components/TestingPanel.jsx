import React, { useState, useEffect, useRef, useMemo } from 'react'
import { Card, Button, Progress, Statistic, Row, Col, Table, Tag, Select, message, Spin, Empty, Drawer, Space, InputNumber, Slider } from 'antd'
import { EyeOutlined } from '@ant-design/icons'
import ReactECharts from 'echarts-for-react'
import axios from 'axios'

const DEFECT_COLORS = {
  OK: '#52c41a', Dl: '#f5222d', Db: '#fa8c16', Po: '#fadb14',
  Vo: '#722ed1', In: '#1890ff', Fb: '#13c2c2', Rs: '#2f54eb',
  Cp: '#eb2f96', Uc: '#d9d9d9'
}

const DEFECT_FULL_NAMES = {
  OK: '好区', Dl: '分层', Db: '脱粘', Po: '孔隙',
  Vo: '气孔', In: '夹杂', Fb: '纤维相关', Rs: '树脂相关',
  Cp: '耦合不良', Uc: '不可识别'
}

export default function TestingPanel() {
  const [models, setModels] = useState([])
  const [selectedModel, setSelectedModel] = useState(null)
  const [modelsLoading, setModelsLoading] = useState(true)

  // 测试状态
  const [jobId, setJobId] = useState(null)
  const [status, setStatus] = useState(null)
  const [progress, setProgress] = useState(0)
  const [statusText, setStatusText] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  // 筛选
  const [filterErrors, setFilterErrors] = useState(false)

  // 文件预览
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewFile, setPreviewFile] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState(null)
  const [pFrameIndex, setPFrameIndex] = useState(0)
  const [pPlaying, setPPlaying] = useState(false)
  const [pPlaySpeed, setPPlaySpeed] = useState(100)
  const [pColorMap, setPColorMap] = useState('Greys')
  const [pXDim, setPXDim] = useState('D2')
  const [pYDim, setPYDim] = useState('D0')
  const [pReverseX, setPReverseX] = useState(false)
  const [pReverseY, setPReverseY] = useState(false)
  const pPlayTimer = useRef(null)

  const pollTimer = useRef(null)

  // 加载模型列表
  useEffect(() => {
    axios.get('http://127.0.0.1:8000/test/models')
      .then(res => setModels(res.data.models || []))
      .catch(() => message.error('无法加载模型列表'))
      .finally(() => setModelsLoading(false))
  }, [])

  // 轮询测试状态
  useEffect(() => {
    if (!jobId) return
    const poll = () => {
      axios.get(`http://127.0.0.1:8000/test/status/${jobId}`)
        .then(res => {
          const s = res.data
          setStatus(s.status)
          setProgress(s.progress || 0)

          if (s.status === 'loading') setStatusText('加载模型中…')
          else if (s.status === 'testing') setStatusText('测试中…')
          else if (s.status === 'error') {
            setError(s.error)
            setStatusText('测试出错')
            clearInterval(pollTimer.current)
          } else if (s.status === 'done') {
            setStatusText('测试完成')
            clearInterval(pollTimer.current)
            axios.get(`http://127.0.0.1:8000/test/result/${jobId}`)
              .then(r => setResult(r.data))
              .catch(() => message.error('获取测试结果失败'))
          }
        })
        .catch(() => {
          clearInterval(pollTimer.current)
          setStatus('error')
          setError('连接失败')
        })
    }
    poll()
    pollTimer.current = setInterval(poll, 2000)
    return () => clearInterval(pollTimer.current)
  }, [jobId])

  // 开始测试
  const handleStart = () => {
    if (!selectedModel) {
      message.warning('请先选择一个模型')
      return
    }
    setStatus('pending')
    setProgress(0)
    setStatusText('排队中…')
    setResult(null)
    setError(null)

    axios.post('http://127.0.0.1:8000/test/start', {
      model_name: selectedModel,
      test_size: 1.0,
    })
      .then(res => setJobId(res.data.job_id))
      .catch(err => {
        message.error('启动测试失败')
        setStatus('error')
        setError(err.message)
      })
  }

  // 混淆矩阵
  const cmOption = result && result.confusion_matrix ? {
    tooltip: { position: 'top' },
    grid: { left: 100, right: 40, top: 20, bottom: 40 },
    xAxis: { type: 'category', data: result.confusion_matrix_labels, axisLabel: { color: '#ccc' } },
    yAxis: { type: 'category', data: result.confusion_matrix_labels, axisLabel: { color: '#ccc' } },
    visualMap: { min: 0, max: Math.max(...result.confusion_matrix.flat(), 1), inRange: { color: ['#1a1a2e', '#16213e', '#0f3460', '#e94560'] } },
    series: [{
      type: 'heatmap',
      data: result.confusion_matrix.flatMap((row, i) =>
        row.map((v, j) => [j, i, v])
      ),
      label: { show: true, color: '#fff', fontSize: 14 },
    }]
  } : null

  // 数据预处理
  const modelOptions = models.map(m => ({
    value: m.model_name,
    label: `${m.model_name || m.model_file}  (${(m.accuracy * 100).toFixed(1)}%)`,
  }))

  // 逐文件结果表格列
  const fileColumns = [
    { title: '#', dataIndex: 'idx', key: 'idx', width: 40 },
    {
      title: '真实标签',
      dataIndex: 'true',
      key: 'true',
      width: 100,
      render: v => v ? <Tag color={DEFECT_COLORS[v] || '#888'}>{DEFECT_FULL_NAMES[v] || v}</Tag> : '-',
    },
    {
      title: '预测标签',
      dataIndex: 'pred',
      key: 'pred',
      width: 100,
      render: v => <Tag color={DEFECT_COLORS[v] || '#888'}>{DEFECT_FULL_NAMES[v] || v}</Tag>,
    },
    {
      title: '结果',
      dataIndex: 'correct',
      key: 'correct',
      width: 70,
      render: v => {
        if (v === true) return <span style={{ color: '#52c41a', fontWeight: 'bold' }}>✅ 正确</span>
        if (v === false) return <span style={{ color: '#f5222d', fontWeight: 'bold' }}>❌ 错误</span>
        return '-'
      }
    },
    {
      title: '置信度',
      key: 'confidence',
      width: 100,
      render: (_, record) => {
        const probs = record.probabilities
        if (!probs) return '-'
        const clsIdx = result?.class_names?.indexOf(record.pred)
        if (clsIdx >= 0 && probs[clsIdx] != null) {
          const pct = probs[clsIdx] * 100
          const color = pct > 90 ? '#52c41a' : pct > 70 ? '#faad14' : '#f5222d'
          return <span style={{ color, fontWeight: 'bold' }}>{pct.toFixed(1)}%</span>
        }
        return '-'
      }
    },
    {
      title: '操作',
      key: 'action',
      width: 70,
      render: (_, record) => (
        <Button
          type="link"
          size="small"
          icon={<EyeOutlined />}
          disabled={!record.file_path}
          onClick={() => handlePreview(record.file_path)}
        >
          查看
        </Button>
      ),
    },
  ]

  // 筛选后的数据
  const fileData = result?.per_file
    ? result.per_file
        .map((f, i) => ({ ...f, idx: i + 1, key: i }))
        .filter(f => !filterErrors || f.correct === false)
    : []

  const isRunning = ['pending', 'loading', 'testing'].includes(status)

  // ═══ 文件预览 ═══
  const handlePreview = async (filePath) => {
    if (!filePath) return
    setPreviewOpen(true)
    setPreviewLoading(true)
    setPreviewError(null)
    setPreviewFile(null)
    setPFrameIndex(0)
    setPPlaying(false)
    try {
      const res = await axios.get('http://127.0.0.1:8000/test/file_preview', {
        params: { path: filePath }
      })
      if (res.data.error) {
        setPreviewError(res.data.error)
      } else {
        setPreviewFile(res.data)
      }
    } catch (err) {
      setPreviewError('加载文件失败: ' + err.message)
    } finally {
      setPreviewLoading(false)
    }
  }

  // 关闭预览时清理播放
  const closePreview = () => {
    setPPlaying(false)
    clearInterval(pPlayTimer.current)
    setPreviewOpen(false)
    setPreviewFile(null)
    setPreviewError(null)
  }

  // 预览 A-Scan 自动播放
  useEffect(() => {
    if (!pPlaying || !previewFile) {
      clearInterval(pPlayTimer.current)
      return
    }
    pPlayTimer.current = setInterval(() => {
      setPFrameIndex(prev => {
        const next = prev + 1
        if (next >= (previewFile.bscan?.length || 0)) {
          setPPlaying(false)
          return 0
        }
        return next
      })
    }, pPlaySpeed)
    return () => clearInterval(pPlayTimer.current)
  }, [pPlaying, previewFile, pPlaySpeed])

  // 预览 Heatmap 轴选择
  const handlePXDimChange = (value) => {
    if (value === pYDim) {
      const dims = ['D0', 'D1', 'D2']
      const remain = dims.find(d => d !== value && d !== pXDim)
      setPYDim(remain)
    }
    setPXDim(value)
  }
  const handlePYDimChange = (value) => {
    if (value === pXDim) {
      const dims = ['D0', 'D1', 'D2']
      const remain = dims.find(d => d !== value && d !== pYDim)
      setPXDim(remain)
    }
    setPYDim(value)
  }

  // 预览 Heatmap 颜色方案
  const getPColorMapColors = () => {
    switch (pColorMap) {
      case 'Viridis': return ['#440154', '#3b528b', '#21918c', '#5dc863', '#fde725']
      case 'Inferno': return ['#000004', '#420a68', '#932667', '#dd513a', '#fba40a', '#fcffa4']
      case 'Turbo':   return ['#30123b', '#4145ab', '#4693ff', '#39d353', '#f9e721', '#ff6b00', '#7a0403']
      case 'Plasma':  return ['#0d0887', '#7e03a8', '#cc4778', '#f89540', '#f0f921']
      case 'Magma':   return ['#000004', '#3b0f70', '#8c2981', '#de4968', '#fe9f6d', '#fcfdbf']
      default:        return ['#000000', '#555555', '#aaaaaa', '#ffffff']
    }
  }

  // 预览 Heatmap 数据变换
  const displayHeatmap = useMemo(() => {
    if (!previewFile?.bscan) return null
    let matrix = previewFile.bscan
    if (pXDim === 'D0' && pYDim === 'D2') {
      const rows = matrix.length
      const cols = matrix[0].length
      matrix = Array.from({ length: cols }, (_, x) =>
        Array.from({ length: rows }, (_, y) => previewFile.bscan[y][x])
      )
    }
    if (pReverseY) matrix = [...matrix].reverse()
    if (pReverseX) matrix = matrix.map(row => [...row].reverse())
    return matrix
  }, [previewFile, pXDim, pYDim, pReverseX, pReverseY])

  // 预览 B-scan 热力图 option
  const bscanOption = displayHeatmap ? {
    animation: false,
    grid: { top: 10, bottom: 20, left: 60, right: 90, containLabel: true },
    tooltip: { show: false },
    visualMap: {
      min: -2000,
      max: 2000,
      calculable: true,
      orient: 'vertical',
      right: 10,
      top: 'middle',
      itemHeight: 250,
      itemWidth: 20,
      inRange: { color: getPColorMapColors() }
    },
    xAxis: {
      type: 'category',
      data: displayHeatmap[0].map((_, i) => i).filter(i => i % 8 === 0)
    },
    yAxis: {
      type: 'category',
      data: displayHeatmap.map((_, i) => i)
    },
    series: [{
      type: 'heatmap',
      progressive: 5000,
      data: displayHeatmap.flatMap((row, y) =>
        row.filter((_, x) => x % 8 === 0).map((v, x) => [x, y, v])
      )
    }]
  } : null

  // 预览 A-scan 当前帧
  const currentWave = previewFile?.bscan?.[pFrameIndex] || previewFile?.ascan || []

  // 预览 A-scan 波形 option
  const ascanOption = previewFile ? {
    tooltip: {},
    xAxis: { type: 'category', data: currentWave.map((_, i) => i) },
    yAxis: { type: 'value', min: -2000, max: 2000 },
    series: [{ type: 'line', smooth: true, data: currentWave }]
  } : null

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 12, overflow: 'auto', paddingRight: 4 }}>
      {modelsLoading ? (
        <Spin size="large" style={{ display: 'block', margin: '80px auto' }} />
      ) : (
        <>
          {/* ═══ 模型选择 ═══ */}
          <Card size="small" title="模型选择">
            <Row gutter={16} align="middle">
              <Col span={12}>
                <Select
                  placeholder="选择要测试的模型"
                  value={selectedModel}
                  onChange={setSelectedModel}
                  style={{ width: '100%' }}
                  disabled={isRunning}
                  showSearch
                  options={modelOptions}
                  notFoundContent={models.length === 0 ? <Empty description="暂无已训练的模型" /> : null}
                />
              </Col>
              <Col span={4}>
                <Button type="primary" block size="large"
                  onClick={handleStart}
                  disabled={isRunning || !selectedModel}
                  loading={isRunning}
                >
                  {isRunning ? '测试中…' : '开始测试'}
                </Button>
              </Col>
              <Col span={4}>
                <Button block size="large"
                  onClick={() => {
                    setJobId(null); setStatus(null); setProgress(0)
                    setResult(null); setError(null); setStatusText('')
                  }}
                  disabled={!result && status !== 'error'}
                >
                  重置
                </Button>
              </Col>
            </Row>

            {/* 选中的模型信息 */}
            {selectedModel && !result && (
              <div style={{ marginTop: 8, color: '#888', fontSize: 12 }}>
                {(() => {
                  const m = models.find(x => x.model_name === selectedModel)
                  if (!m) return null
                  return `模型类型: ${m.model_type === 'deep_cnn_lstm_transformer' ? 'CNN+LSTM+Transformer' : 'RandomForest'}  |  训练准确率: ${(m.accuracy * 100).toFixed(1)}%  |  缺陷类别: ${(m.class_names || []).length} 类`
                })()}
              </div>
            )}
          </Card>

          {/* ═══ 进度 ═══ */}
          {status && (
            <Card size="small">
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <Progress
                  percent={progress}
                  status={status === 'error' ? 'exception' : 'active'}
                  strokeColor={status === 'done' ? '#52c41a' : undefined}
                  style={{ flex: 1, margin: 0 }}
                />
                <span style={{ color: '#999', whiteSpace: 'nowrap', fontSize: 13 }}>
                  {statusText}
                  {status === 'done' && ' ✅'}
                  {status === 'error' && ' ❌'}
                </span>
              </div>
            </Card>
          )}

          {/* ═══ 测试结果 ═══ */}
          {result && (
            <>
              {/* 准确率对比 */}
              <Card size="small">
                <Row gutter={24} justify="center" align="middle">
                  <Col>
                    <Statistic
                      title="测试准确率"
                      value={result.accuracy * 100}
                      suffix="%"
                      precision={2}
                      valueStyle={{ color: result.accuracy > 0.8 ? '#52c41a' : '#faad14', fontSize: 36 }}
                    />
                  </Col>
                  <Col>
                    <Statistic title="训练验证集准确率" value={(result.model_accuracy || 0) * 100} suffix="%" precision={2} />
                  </Col>
                  <Col>
                    <Statistic title="测试样本数" value={result.n_test_samples} />
                  </Col>
                  <Col>
                    <Statistic title="分类类别" value={result.class_names?.length} />
                  </Col>
                  {result.error_files && (
                    <Col>
                      <Statistic
                        title="预测错误"
                        value={result.error_files.length}
                        valueStyle={{ color: result.error_files.length > 0 ? '#f5222d' : '#52c41a' }}
                      />
                    </Col>
                  )}
                </Row>
              </Card>

              <Row gutter={12}>
                {/* 混淆矩阵 */}
                <Col span={12}>
                  <Card size="small" title="混淆矩阵（新数据）" bodyStyle={{ padding: 8 }}>
                    <ReactECharts option={cmOption} style={{ height: 300 }} />
                  </Card>
                </Col>
                {/* 准确率对比柱状图 */}
                <Col span={12}>
                  <Card size="small" title="准确率对比" bodyStyle={{ padding: 8 }}>
                    <ReactECharts option={{
                      tooltip: { trigger: 'axis' },
                      grid: { left: 50, right: 20, top: 20, bottom: 20 },
                      xAxis: { type: 'category', data: ['训练验证集', '测试集'], axisLabel: { color: '#999' } },
                      yAxis: { type: 'value', min: 0, max: 1, axisLabel: { color: '#999', formatter: '{value}%' }, splitLine: { lineStyle: { color: '#333' } } },
                      series: [{
                        type: 'bar',
                        data: [
                          { value: result.model_accuracy || 0, itemStyle: { color: '#1890ff' } },
                          { value: result.accuracy, itemStyle: { color: result.accuracy > 0.8 ? '#52c41a' : '#faad14' } }
                        ],
                        barWidth: 60,
                        label: { show: true, formatter: p => (p.value * 100).toFixed(1) + '%', color: '#fff', position: 'top' }
                      }]
                    }} style={{ height: 300 }} />
                  </Card>
                </Col>
              </Row>

              {/* 逐文件结果 */}
              <Card
                size="small"
                title={
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span>逐文件预测结果</span>
                    <Tag
                      color={filterErrors ? 'red' : 'default'}
                      style={{ cursor: 'pointer' }}
                      onClick={() => setFilterErrors(!filterErrors)}
                    >
                      {filterErrors ? '仅显示错误' : `显示全部 (${result.per_file?.length || 0})`}
                    </Tag>
                    {result.error_files?.length > 0 && (
                      <span style={{ color: '#f5222d', fontSize: 12 }}>
                        {result.error_files.length} 个错误
                      </span>
                    )}
                  </div>
                }
                bodyStyle={{ padding: 0 }}
              >
                <Table
                  columns={fileColumns}
                  dataSource={fileData}
                  size="small"
                  pagination={{ pageSize: 10, showSizeChanger: true, showTotal: t => `共 ${t} 条` }}
                  scroll={{ y: 400 }}
                />
              </Card>
            </>
          )}

          {/* ═══ 错误显示 ═══ */}
          {error && (
            <Card size="small" title="错误信息" style={{ borderColor: '#ff4d4f' }}>
              <pre style={{ color: '#ff4d4f', margin: 0, whiteSpace: 'pre-wrap', fontSize: 12 }}>
                {error}
              </pre>
            </Card>
          )}

          {/* ═══ 文件预览 Drawer ═══ */}
          <Drawer
            title={previewFile ? `文件预览: ${previewFile.filename}` : '文件预览'}
            placement="right"
            width={700}
            open={previewOpen}
            onClose={closePreview}
          >
            {previewLoading && <Spin size="large" style={{ display: 'block', margin: '40px auto' }} />}
            {previewError && <div style={{ color: '#ff4d4f' }}>{previewError}</div>}
            {previewFile && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {/* 文件信息 */}
                <Card size="small">
                  <Row gutter={16}>
                    <Col>
                      <Statistic title="文件名" value={previewFile.filename} valueStyle={{ fontSize: 14 }} />
                    </Col>
                    <Col>
                      <Statistic
                        title="标签"
                        value={DEFECT_FULL_NAMES[previewFile.label] || previewFile.label}
                        valueStyle={{ color: DEFECT_COLORS[previewFile.label] || '#fff', fontWeight: 'bold' }}
                      />
                    </Col>
                    <Col>
                      <Statistic title="数据形状" value={`${previewFile.shape?.[0] || '-'} × ${previewFile.shape?.[1] || '-'}`} valueStyle={{ fontSize: 14 }} />
                    </Col>
                  </Row>
                </Card>

                {/* A-Scan — 匹配 AScanViewer */}
                {previewFile.bscan && previewFile.bscan.length > 0 && (
                  <Card size="small" title={`A-Scan Frame ${pFrameIndex}`} bodyStyle={{ padding: 4 }}>
                    <Slider
                      min={0}
                      max={previewFile.bscan.length - 1}
                      value={pFrameIndex}
                      onChange={v => {
                        setPFrameIndex(v)
                      }}
                    />
                    <div style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'center', marginLeft: 4 }}>
                      <Button onClick={() => setPFrameIndex(prev => Math.max(prev - 1, 0))}>Prev</Button>
                      <Button type="primary" onClick={() => setPPlaying(true)} disabled={pPlaying}>▶ Play</Button>
                      <Button danger onClick={() => setPPlaying(false)} disabled={!pPlaying}>■ Stop</Button>
                      <Button onClick={() => setPFrameIndex(prev => Math.min(prev + 1, previewFile.bscan.length - 1))}>Next</Button>
                      <Tag color="blue">{pFrameIndex + 1}/{previewFile.bscan.length}</Tag>
                      <InputNumber
                        min={20} max={1000}
                        value={pPlaySpeed}
                        onChange={v => setPPlaySpeed(v || 100)}
                        addonAfter="ms"
                        size="small"
                        style={{ width: 110 }}
                      />
                    </div>
                  </Card>
                )}

                {/* A-Scan 波形 */}
                <Card size="small" title="A-Scan Waveform" bodyStyle={{ padding: 4 }}>
                  <ReactECharts option={ascanOption} style={{ height: 400 }} />
                </Card>

                {/* B-Scan 热力图 — 匹配 HeatmapViewer */}
                <Card
                  size="small"
                  title="B-Scan Heatmap"
                  extra={
                    <Select
                      value={pColorMap}
                      style={{ width: 140 }}
                      onChange={setPColorMap}
                      options={[
                        { value: 'Greys', label: 'Greys' },
                        { value: 'Viridis', label: 'Viridis' },
                        { value: 'Inferno', label: 'Inferno' },
                        { value: 'Turbo', label: 'Turbo' },
                        { value: 'Plasma', label: 'Plasma' },
                        { value: 'Magma', label: 'Magma' }
                      ]}
                    />
                  }
                  bodyStyle={{ padding: 4 }}
                >
                  <Space wrap style={{ marginBottom: 12, marginLeft: 4 }}>
                    <span>X:</span>
                    <Button size="small" type={pXDim === 'D0' ? 'primary' : 'default'} onClick={() => handlePXDimChange('D0')}>D0</Button>
                    <Button size="small" type={pXDim === 'D1' ? 'primary' : 'default'} onClick={() => handlePXDimChange('D1')}>D1</Button>
                    <Button size="small" type={pXDim === 'D2' ? 'primary' : 'default'} onClick={() => handlePXDimChange('D2')}>D2</Button>
                    <Button size="small" type={pReverseX ? 'primary' : 'default'} onClick={() => setPReverseX(!pReverseX)}>Reverse X</Button>
                    <span style={{ marginLeft: 20 }}>Y:</span>
                    <Button size="small" type={pYDim === 'D0' ? 'primary' : 'default'} onClick={() => handlePYDimChange('D0')}>D0</Button>
                    <Button size="small" type={pYDim === 'D1' ? 'primary' : 'default'} onClick={() => handlePYDimChange('D1')}>D1</Button>
                    <Button size="small" type={pYDim === 'D2' ? 'primary' : 'default'} onClick={() => handlePYDimChange('D2')}>D2</Button>
                    <Button size="small" type={pReverseY ? 'primary' : 'default'} onClick={() => setPReverseY(!pReverseY)}>Reverse Y</Button>
                  </Space>
                  {bscanOption && (
                    <ReactECharts option={bscanOption} style={{ height: 350 }} />
                  )}
                </Card>
              </div>
            )}
          </Drawer>
        </>
      )}
    </div>
  )
}
