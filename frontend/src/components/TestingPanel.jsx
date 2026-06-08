import React, { useState, useEffect, useRef } from 'react'
import { Card, Button, Progress, Statistic, Row, Col, Table, Tag, Select, message, Spin, Empty } from 'antd'
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
      dataIndex: 'confidence',
      key: 'confidence',
      width: 100,
      render: (v, record) => {
        if (v == null) return '-'
        const clsIdx = result?.class_names?.indexOf(record.pred)
        if (clsIdx >= 0 && v[clsIdx] != null) {
          return (v[clsIdx] * 100).toFixed(1) + '%'
        }
        return '-'
      }
    },
  ]

  // 筛选后的数据
  const fileData = result?.per_file
    ? result.per_file
        .map((f, i) => ({ ...f, idx: i + 1, key: i }))
        .filter(f => !filterErrors || f.correct === false)
    : []

  const isRunning = ['pending', 'loading', 'testing'].includes(status)

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
        </>
      )}
    </div>
  )
}
