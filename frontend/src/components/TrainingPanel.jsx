import React, { useState, useEffect, useRef } from 'react'
import { Card, Button, Progress, Statistic, Row, Col, Table, Tag, Slider, InputNumber, Select, message, Spin, Empty } from 'antd'
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

const FIBER_COLORS = {
  CF: '#1890ff', GF: '#52c41a', GFAF: '#fa8c16', BF: '#f5222d',
  AF: '#722ed1',
}
const FIBER_NAMES = {
  CF: '碳纤维(CF)', GF: '玻璃纤维(GF)', GFAF: '玻纤/芳纶(GFAF)',
  BF: '硼纤维(BF)', AF: '芳纶纤维(AF)',
}
const FIBER_GRADE_COLORS = [
  '#1890ff', '#52c41a', '#fa8c16', '#f5222d', '#722ed1',
  '#13c2c2', '#2f54eb', '#eb2f96', '#fadb14', '#fa541c',
]

const MODEL_OPTIONS = [
  { value: 'random_forest', label: 'RandomForest（随机森林）', group: '传统机器学习' },
  { value: 'deep_cnn_lstm_transformer', label: 'CNN + LSTM + Transformer', group: '深度学习' },
]

export default function TrainingPanel() {
  const [preview, setPreview] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(true)

  // ── 模型类型 ──
  const [modelType, setModelType] = useState('random_forest')

  // ── RandomForest 配置 ──
  const [testSize, setTestSize] = useState(0.2)
  const [nEstimators, setNEstimators] = useState(100)
  const [maxDepth, setMaxDepth] = useState(null)

  // ── 深度学习配置 ──
  const [epochs, setEpochs] = useState(20)
  const [batchSize, setBatchSize] = useState(16)
  const [learningRate, setLearningRate] = useState(0.001)

  // ── 训练状态 ──
  const [jobId, setJobId] = useState(null)
  const [status, setStatus] = useState(null)   // idle | pending | loading | training | done | error
  const [progress, setProgress] = useState(0)
  const [statusText, setStatusText] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const pollTimer = useRef(null)

  // ── 加载预览 ──
  useEffect(() => {
    axios.get('http://127.0.0.1:8000/train/preview')
      .then(res => setPreview(res.data))
      .catch(() => message.error('无法加载数据集预览'))
      .finally(() => setPreviewLoading(false))
  }, [])

  // ── 轮询训练状态 ──
  useEffect(() => {
    if (!jobId) return
    const poll = () => {
      axios.get(`http://127.0.0.1:8000/train/status/${jobId}`)
        .then(res => {
          const s = res.data
          setStatus(s.status)
          setProgress(s.progress || 0)

          if (s.status === 'loading') setStatusText('加载数据中…')
          else if (s.status === 'training') setStatusText('训练中…')
          else if (s.status === 'error') {
            setError(s.error)
            setStatusText('训练出错')
            clearInterval(pollTimer.current)
          } else if (s.status === 'done') {
            setStatusText('训练完成')
            clearInterval(pollTimer.current)
            // 取结果
            axios.get(`http://127.0.0.1:8000/train/result/${jobId}`)
              .then(r => setResult(r.data))
              .catch(() => message.error('获取训练结果失败'))
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

  // ── 开始训练 ──
  const handleStart = () => {
    setStatus('pending')
    setProgress(0)
    setStatusText('排队中…')
    setResult(null)
    setError(null)

    const body = {
      model_type: modelType,
      test_size: testSize,
    }
    if (modelType === 'random_forest') {
      body.n_estimators = nEstimators
      body.max_depth = maxDepth || null
    } else {
      body.epochs = epochs
      body.batch_size = batchSize
      body.learning_rate = learningRate
    }

    axios.post('http://127.0.0.1:8000/train/start', body)
      .then(res => setJobId(res.data.job_id))
      .catch(err => {
        message.error('启动训练失败')
        setStatus('error')
        setError(err.message)
      })
  }

  // ── 缺陷分布饼图 ──
  const defectPieOption = preview ? {
    tooltip: { trigger: 'item', formatter: '{b}: {c} 文件 ({d}%)' },
    series: [{
      type: 'pie',
      radius: ['30%', '52%'],
      center: ['50%', '50%'],
      label: {
        formatter: '{b} ({d}%)',
        color: '#333',
        fontSize: 10,
        show: true,
      },
      data: Object.entries(preview.by_defect || {}).map(([k, v]) => ({
        name: DEFECT_FULL_NAMES[k] || k,
        value: v.count,
        itemStyle: { color: DEFECT_COLORS[k] || '#888' }
      }))
    }]
  } : null

  // ── 材料分布饼图 ──
  const materialPieOption = preview?.by_material ? {
    tooltip: { trigger: 'item', formatter: '{b}: {c} 文件 ({d}%)' },
    series: [{
      type: 'pie',
      radius: ['30%', '52%'],
      center: ['50%', '50%'],
      label: {
        formatter: '{b} ({d}%)',
        color: '#333',
        fontSize: 10,
        show: true,
      },
      data: Object.entries(preview.by_material).map(([k, v], i) => ({
        name: k,
        value: v,
        itemStyle: { color: FIBER_GRADE_COLORS[i % FIBER_GRADE_COLORS.length] }
      }))
    }]
  } : null

  // ── 混淆矩阵热力图 ──
  const cmOption = result ? {
    tooltip: { position: 'top' },
    grid: { left: 100, right: 40, top: 20, bottom: 40 },
    xAxis: { type: 'category', data: result.confusion_matrix_labels, axisLabel: { color: '#ccc' } },
    yAxis: { type: 'category', data: result.confusion_matrix_labels, axisLabel: { color: '#ccc' } },
    visualMap: { min: 0, max: Math.max(...result.confusion_matrix.flat()), inRange: { color: ['#1a1a2e', '#16213e', '#0f3460', '#e94560'] } },
    series: [{
      type: 'heatmap',
      data: result.confusion_matrix.flatMap((row, i) =>
        row.map((v, j) => [j, i, v])
      ),
      label: { show: true, color: '#fff', fontSize: 14, fontWeight: 'bold' },
      emphasis: { itemStyle: { shadowBlur: 10 } }
    }]
  } : null

  // ── 训练历史曲线（深度学习） ──
  const historyOption = result?.training_history ? {
    tooltip: { trigger: 'axis' },
    legend: { data: ['Train Acc', 'Test Acc', 'Train Loss'], textStyle: { color: '#999' }, top: 0 },
    grid: { left: 50, right: 20, top: 40, bottom: 30 },
    xAxis: { type: 'category', data: result.training_history.map(h => `E${h.epoch}`), axisLabel: { color: '#999' } },
    yAxis: [
      { type: 'value', name: '准确率', min: 0, max: 1, axisLabel: { color: '#999' }, splitLine: { lineStyle: { color: '#333' } } },
      { type: 'value', name: 'Loss', axisLabel: { color: '#999' }, splitLine: { show: false } },
    ],
    series: [
      { name: 'Train Acc', type: 'line', data: result.training_history.map(h => h.train_acc), smooth: true, symbol: 'none', lineStyle: { width: 2 } },
      { name: 'Test Acc', type: 'line', data: result.training_history.map(h => h.test_acc), smooth: true, symbol: 'none', lineStyle: { width: 2 } },
      { name: 'Train Loss', type: 'line', yAxisIndex: 1, data: result.training_history.map(h => h.train_loss), smooth: true, symbol: 'none', lineStyle: { width: 1, type: 'dashed' }, itemStyle: { color: '#e94560' } },
    ]
  } : null

  // ── 分类报告表格 ──
  const reportColumns = [
    { title: '类别', dataIndex: 'class', key: 'class' },
    { title: 'Precision', dataIndex: 'precision', key: 'precision', render: v => (v * 100).toFixed(1) + '%' },
    { title: 'Recall', dataIndex: 'recall', key: 'recall', render: v => (v * 100).toFixed(1) + '%' },
    { title: 'F1-Score', dataIndex: 'f1', key: 'f1', render: v => (v * 100).toFixed(1) + '%' },
    { title: '样本数', dataIndex: 'support', key: 'support' },
  ]

  const reportData = result ? Object.entries(result.classification_report || {})
    .filter(([k]) => !['accuracy', 'macro avg', 'weighted avg'].includes(k))
    .map(([k, v]) => ({
      key: k,
      class: <Tag color={DEFECT_COLORS[k] || '#888'}>{DEFECT_FULL_NAMES[k] || k}</Tag>,
      precision: v.precision,
      recall: v.recall,
      f1: v['f1-score'],
      support: v.support
    })) : []

  // 模型显示标签
  const modelLabel = MODEL_OPTIONS.find(m => m.value === (result?.model_type || modelType))?.label || modelType

  // ── 训练中 ──
  const isRunning = ['pending', 'loading', 'training'].includes(status)
  const isDeep = modelType === 'deep_cnn_lstm_transformer'

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 12, overflow: 'auto', paddingRight: 4 }}>
      {previewLoading ? (
        <Spin size="large" style={{ display: 'block', margin: '80px auto' }} />
      ) : !preview || preview.error ? (
        <Empty description="未找到 dataset 目录" style={{ marginTop: 80 }} />
      ) : (
        <>
          {/* ═══ 数据集概览 ═══ */}
          <Row gutter={12}>
            <Col span={8}>
              <Card size="small" title="数据集概览">
                <Statistic title="总文件数" value={preview.total_files} suffix="个" />
                <div style={{ marginTop: 12 }}>
                  <Statistic title="特征维度" value={preview.n_features_total || preview.n_features} suffix="维（含元数据）" />
                </div>
                <div style={{ marginTop: 12 }}>
                  <Statistic title="缺陷类别" value={Object.keys(preview.by_defect || {}).length} suffix="类" />
                </div>
                <div style={{ marginTop: 12 }}>
                  <Statistic title="材料体系" value={Object.keys(preview.by_material || {}).length} suffix="种" />
                </div>
              </Card>
            </Col>
            <Col span={8}>
              <Card size="small" title="各类缺陷分布" bodyStyle={{ padding: 4 }}>
                <ReactECharts option={defectPieOption} style={{ height: 280 }} />
              </Card>
            </Col>
            <Col span={8}>
              <Card size="small" title="材料分布" bodyStyle={{ padding: 4 }}>
                <ReactECharts option={materialPieOption} style={{ height: 280 }} />
              </Card>
            </Col>
          </Row>

          {/* ═══ 训练配置 ═══ */}
          <Card size="small" title="训练配置">
            <Row gutter={16} align="middle">
              {/* 模型类型选择 */}
              <Col span={6}>
                <div style={{ marginBottom: 4, color: '#999' }}>模型类型</div>
                <Select
                  value={modelType}
                  onChange={setModelType}
                  style={{ width: '100%' }}
                  disabled={isRunning}
                  options={[
                    { label: '传统机器学习', options: [MODEL_OPTIONS[0]] },
                    { label: '深度学习', options: [MODEL_OPTIONS[1]] },
                  ]}
                />
              </Col>

              {/* 公共：测试集比例 */}
              <Col span={4}>
                <div style={{ marginBottom: 4, color: '#999' }}>验证集比例</div>
                <Slider
                  min={0.1} max={0.4} step={0.05}
                  value={testSize} onChange={setTestSize}
                  marks={{ 0.1: '10%', 0.2: '20%', 0.3: '30%', 0.4: '40%' }}
                  disabled={isRunning}
                />
              </Col>

              {/* RandomForest 参数 */}
              {!isDeep && (
                <>
                  <Col span={3}>
                    <div style={{ marginBottom: 4, color: '#999' }}>决策树数量</div>
                    <InputNumber min={10} max={500} step={10}
                      value={nEstimators} onChange={setNEstimators}
                      disabled={isRunning} style={{ width: '100%' }} />
                  </Col>
                  <Col span={3}>
                    <div style={{ marginBottom: 4, color: '#999' }}>最大深度</div>
                    <InputNumber min={3} max={100}
                      value={maxDepth} onChange={setMaxDepth}
                      disabled={isRunning}
                      placeholder="不限" style={{ width: '100%' }} />
                  </Col>
                </>
              )}

              {/* 深度学习参数 */}
              {isDeep && (
                <>
                  <Col span={3}>
                    <div style={{ marginBottom: 4, color: '#999' }}>训练轮次</div>
                    <InputNumber min={5} max={200} step={5}
                      value={epochs} onChange={setEpochs}
                      disabled={isRunning} style={{ width: '100%' }} />
                  </Col>
                  <Col span={3}>
                    <div style={{ marginBottom: 4, color: '#999' }}>Batch Size</div>
                    <InputNumber min={4} max={128} step={4}
                      value={batchSize} onChange={setBatchSize}
                      disabled={isRunning} style={{ width: '100%' }} />
                  </Col>
                  <Col span={3}>
                    <div style={{ marginBottom: 4, color: '#999' }}>学习率</div>
                    <InputNumber min={0.0001} max={0.01} step={0.0001}
                      value={learningRate} onChange={setLearningRate}
                      disabled={isRunning}
                      stringMode style={{ width: '100%' }} />
                  </Col>
                </>
              )}

              {/* 按钮 */}
              <Col span={3}>
                <div style={{ marginBottom: 4, color: '#999' }}>&nbsp;</div>
                <Button type="primary" block
                  onClick={handleStart}
                  disabled={isRunning}
                  loading={isRunning}
                  size="large"
                >
                  {isRunning ? '训练中…' : '开始训练'}
                </Button>
              </Col>
              <Col span={2}>
                <div style={{ marginBottom: 4, color: '#999' }}>&nbsp;</div>
                <Button block
                  onClick={() => {
                    setJobId(null)
                    setStatus(null)
                    setProgress(0)
                    setResult(null)
                    setError(null)
                    setStatusText('')
                  }}
                  disabled={!result && status !== 'error'}
                  size="large"
                >
                  重置
                </Button>
              </Col>
            </Row>
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

          {/* ═══ 训练结果 ═══ */}
          {result && (
            <>
              {/* 准确率 + 模型信息 */}
              <Card size="small">
                <Row gutter={16} justify="center" align="middle">
                  <Col>
                    <Statistic
                      title="验证集准确率"
                      value={result.accuracy * 100}
                      suffix="%"
                      precision={2}
                      valueStyle={{ color: result.accuracy > 0.8 ? '#52c41a' : '#faad14', fontSize: 36 }}
                    />
                  </Col>
                  <Col>
                    <Statistic title="模型" value={modelLabel} />
                  </Col>
                  <Col>
                    <Statistic title="训练样本" value={result.n_samples} />
                  </Col>
                  <Col>
                    <Statistic title="分类类别" value={result.class_names?.length} />
                  </Col>
                  {result.model_type === 'deep_cnn_lstm_transformer' && (
                    <>
                      <Col>
                        <Statistic title="训练轮次" value={result.epochs} />
                      </Col>
                      <Col>
                        <Statistic title="Batch Size" value={result.batch_size} />
                      </Col>
                    </>
                  )}
                  {result.model_type !== 'deep_cnn_lstm_transformer' && (
                    <Col>
                      <Statistic title="决策树数量" value={result.n_estimators} />
                    </Col>
                  )}
                </Row>
              </Card>

              <Row gutter={12}>
                {/* 混淆矩阵 */}
                <Col span={12}>
                  <Card size="small" title="混淆矩阵" bodyStyle={{ padding: 8 }}>
                    <ReactECharts option={cmOption} style={{ height: 300 }} />
                  </Card>
                </Col>
                {/* 分类报告 */}
                <Col span={12}>
                  <Card size="small" title="分类报告" bodyStyle={{ padding: 0 }}>
                    <Table
                      columns={reportColumns}
                      dataSource={reportData}
                      pagination={false}
                      size="small"
                    />
                  </Card>
                </Col>
              </Row>

              {/* 深度学习训练曲线 */}
              {result.training_history && (
                <Card size="small" title="训练历史曲线">
                  <ReactECharts option={historyOption} style={{ height: 250 }} />
                </Card>
              )}
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
        </>
      )}
    </div>
  )
}
