import React, { useState, useEffect } from 'react'
import {
  Card,
  Slider,
  Button,
  Tag,
  InputNumber,
  Radio,
} from 'antd'

import ReactECharts from 'echarts-for-react'
import { DownloadOutlined, SaveOutlined, CheckCircleOutlined } from '@ant-design/icons'

const LABEL_OPTIONS = [
  { value: 0, label: '无缺陷', color: '#52c41a' },
  { value: 1, label: '分层', color: '#f5222d' },
  { value: 2, label: '脱粘', color: '#fa8c16' },
  { value: 3, label: '孔隙', color: '#fadb14' },
  { value: 4, label: '气孔', color: '#722ed1' },
  { value: 5, label: '夹杂', color: '#1890ff' },
  { value: 9, label: '耦合不良', color: '#d9d9d9' },
]

export default function AScanViewer({

  frames,
  wave,

  frameIndex,
  setFrameIndex,

  setWave,

  playing,
  setPlaying,

  playSpeed,
  setPlaySpeed,

  // 逐帧标注
  labels,
  onLabelChange,

  yAxisRange,

}) {

  const [yMin, yMax] = yAxisRange || [-2000, 2000]

  // 使用父组件传入的 labels，配合本地乐观更新
  const [localLabels, setLocalLabels] = useState(null)
  const effectiveLabels = labels || localLabels

  // 自动标注状态
  const [autoLabelData, setAutoLabelData] = useState(null)
  const [autoLabelLoading, setAutoLabelLoading] = useState(false)
  const isAutoOk = autoLabelData?.suggestions?.find(s => s.frame === frameIndex)?.status === "auto_ok"

  // 更新标签（同时更新本地状态和后端）
  const updateLabel = (idx, val) => {
    setLocalLabels(prev => {
      const next = prev ? [...prev] : new Array(frames?.length || 64).fill(-1)
      next[idx] = val
      return next
    })
    // 同步更新 autoLabelData 中的标记
    if (autoLabelData) {
      setAutoLabelData(prev => {
        if (!prev) return prev
        const newSug = prev.suggestions.map(s =>
          s.frame === idx
            ? { ...s, auto_label: val, status: val === 0 ? "manual_ok" : "manual_defect" }
            : s
        )
        return { ...prev, suggestions: newSug }
      })
    }
    if (onLabelChange) onLabelChange(idx, val)
  }

  const updateFrame = idx => {
    setFrameIndex(idx)
    if (frames[idx]) {
      setWave(frames[idx])
    }
  }

  // 自动标注：以当前帧为基准（必须是好区 0），对其他帧做相似度匹配
  const autoLabelFrames = async () => {
    const currentLabel = effectiveLabels?.[frameIndex]
    if (currentLabel === undefined || currentLabel === -1) {
      alert('请先将当前帧标注为「无缺陷」(0)，再进行自动标注')
      return
    }
    if (currentLabel !== 0) {
      alert('自动标注必须以「无缺陷」帧为基准，当前帧不是无缺陷')
      return
    }
    setAutoLabelLoading(true)
    try {
      const res = await fetch('http://127.0.0.1:8000/auto_label_frames', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok_frame_index: frameIndex, similarity_threshold: 0.85 }),
      })
      const data = await res.json()
      if (data.error) {
        alert('自动标注失败: ' + data.error)
        setAutoLabelLoading(false)
        return
      }
      setAutoLabelData(data)
      setLocalLabels(prev => {
        const next = prev ? [...prev] : new Array(frames?.length || 64).fill(-1)
        data.suggestions.forEach(s => {
          if (s.auto_label === 0) next[s.frame] = 0
        })
        return next
      })
      // 同步到父组件，避免切换视图后丢失
      data.suggestions.forEach(s => {
        if (s.auto_label === 0 && onLabelChange) onLabelChange(s.frame, 0)
      })
    } catch (err) {
      alert('自动标注请求失败: ' + err.message)
    }
    setAutoLabelLoading(false)
  }

  // 键盘快捷键：左右键切换帧，数字键标注
  useEffect(() => {
    const handleKeyDown = e => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        // 焦点在 Slider 上时，让 Slider 原生处理（否则冲突跳两帧）
        if (document.activeElement?.closest('.ant-slider')) return
        e.preventDefault()
        const dir = e.key === 'ArrowLeft' ? -1 : 1
        updateFrame(Math.min(Math.max(frameIndex + dir, 0), frames.length - 1))
      } else if (e.key >= '0' && e.key <= '9') {
        const num = parseInt(e.key)
        const label = LABEL_OPTIONS.find(opt => opt.value === num)
        if (label && effectiveLabels) {
          updateLabel(frameIndex, num)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [frameIndex, frames, effectiveLabels])

  return (

    <Card
      
      style={{
        marginBottom:20
      }}
    >

      {wave.length > 0 && (
        <ReactECharts
          option={{
            tooltip:{},
            xAxis:{
              type:'category',
              data:wave.map(
                (_,i)=>i
              )
            },
            yAxis:{
              type:'value',
              min: yMin,
              max: yMax,
            },
            series:[
              {
                type:'line',
                smooth:true,
                data:wave
              }
            ]
          }}
          style={{
            height:400
          }}
        />
      )}

      {frames.length > 0 && (
        <>
          <Slider
            min={0}
            max={frames.length - 1}
            value={frameIndex}
            onChange={updateFrame}
            style={{ marginTop: wave.length > 0 ? 16 : 0 }}
            marks={(() => {
              const m = {}
              if (autoLabelData?.suggestions) {
                autoLabelData.suggestions.forEach(s => {
                  if (s.status === "reference")
                    m[s.frame] = <span style={{ fontSize: 16, lineHeight: '14px', color: '#1890ff' }}>★</span>
                  else if (s.status === "auto_ok" || s.status === "manual_ok")
                    m[s.frame] = <span style={{ fontSize: 16, lineHeight: '14px', color: '#52c41a' }}>●</span>
                  else if (s.status === "manual_defect")
                    m[s.frame] = <span style={{ fontSize: 16, lineHeight: '14px', color: '#f5222d' }}>●</span>
                  else if (s.status === "pending")
                    m[s.frame] = <span style={{ fontSize: 16, lineHeight: '14px', color: '#fa8c16' }}>○</span>
                })
                return m
              }
              if (effectiveLabels) {
                effectiveLabels.forEach((v, i) => {
                  if (v === 0) m[i] = <span style={{ fontSize: 16, lineHeight: '14px', color: '#52c41a' }}>●</span>
                  else if (v > 0) m[i] = <span style={{ fontSize: 16, lineHeight: '14px', color: '#f5222d' }}>●</span>
                })
                if (Object.keys(m).length > 0) return m
              }
              for (let i = 0; i < frames.length; i++) {
                m[i] = <span style={{ fontSize: 12, lineHeight: '14px', color: '#d9d9d9' }}>●</span>
              }
              return m
            })()}
          />
          <div style={{ marginTop: 8, fontSize: 12, color: '#666', display: 'flex', gap: 16, justifyContent: 'center' }}>
            {autoLabelData ? (
              <>
                <span><span style={{ color: '#1890ff' }}>★</span> 参考帧</span>
                <span><span style={{ color: '#52c41a' }}>●</span> 自动标注 OK</span>
                <span><span style={{ color: '#fa8c16' }}>○</span> 待人工补标</span>
                <span style={{ color: '#999' }}>| 操作：选好区→按0→点「自动标注」→补剩余帧</span>
              </>
            ) : (
              <span style={{ color: '#999' }}>操作：选一帧好区，按数字键 0 标注，再点击「自动标注」</span>
            )}
          </div>

          <div
            style={{
              display:'flex',
              gap:10,
              marginTop:20,
              alignItems:'center'
            }}
          >

            <Button
              onClick={() =>
                updateFrame(
                  Math.max(
                    frameIndex - 1,
                    0
                  )
                )
              }
            >
              Prev
            </Button>

            <Button
              type="primary"
              onClick={() =>
                setPlaying(true)
              }
            >
              ▶ Play
            </Button>

            <Button
              danger
              onClick={() =>
                setPlaying(false)
              }
            >
              ■ Stop
            </Button>

            <Button
              onClick={() =>
                updateFrame(
                  Math.min(
                    frameIndex + 1,
                    frames.length - 1
                  )
                )
              }
            >
              Next
            </Button>

            <InputNumber
              min={20}
              max={1000}
              step={10}
              value={playSpeed}
              onChange={v =>
                setPlaySpeed(v || 100)
              }
              addonAfter="ms"
              style={{ width: 100 }}
            />

            {effectiveLabels && effectiveLabels.length > 0 && (
              <div data-label-toolbar style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Tag color="blue">
                  {frameIndex + 1}
                  /
                  {frames.length}
                </Tag>
                <div style={{ fontSize: 12, color: '#666', whiteSpace: 'nowrap' }}>
                  逐帧标注：
                </div>
                <Radio.Group
                  value={effectiveLabels[frameIndex] !== undefined ? effectiveLabels[frameIndex] : -1}
                  onChange={e => updateLabel(frameIndex, e.target.value)}
                  size="small"
                >
                  {LABEL_OPTIONS.map(opt => (
                    <Radio.Button
                      key={opt.value}
                      value={opt.value}
                      style={opt.value === effectiveLabels[frameIndex] ? {
                        borderColor: opt.color,
                        color: opt.color,
                      } : {}}
                    >
                      {opt.label}
                    </Radio.Button>
                  ))}
                </Radio.Group><span style={{ width: 24 }} />
                {/* 自动标注按钮 */}
                <Button
                  size="small"
                  loading={autoLabelLoading}
                  onClick={autoLabelFrames}
                  style={{ borderColor: '#1890ff', color: '#1890ff' }}
                >
                  自动标注
                </Button>
                {autoLabelData && (
                  <Tag color="orange">
                    待补: {autoLabelData.suggestions.filter(s => s.status === "pending").length}帧
                  </Tag>
                )}
                <Button
                  type="primary"
                  size="small"
                  icon={<CheckCircleOutlined />}
                  style={{ background: '#52c41a', borderColor: '#52c41a' }}
                  onClick={async () => {
                    for (let idx = 0; idx < effectiveLabels.length; idx++) {
                      updateLabel(idx, 0)
                    }
                  }}
                >
                  一键标注
                </Button>
                <Button
                  type="primary"
                  size="small"
                  icon={<SaveOutlined />}
                  onClick={async () => {
                    if (!effectiveLabels) return
                    let saved = 0
                    for (let idx = 0; idx < effectiveLabels.length; idx++) {
                      const label = effectiveLabels[idx]
                      if (label !== undefined && label !== -1) {
                        try {
                          await fetch('http://127.0.0.1:8000/save_frame_label', {
                            method: 'POST',
                            headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify({ frame_index: idx, label_id: label }),
                          })
                          saved++
                        } catch (e) {}
                      }
                    }
                    if (saved > 0) {
                      alert(`保存成功，共 ${saved} 帧`)
                    }
                  }}
                >
                  保存
                </Button>
                <Button
                  type="primary"
                  size="small"
                  icon={<DownloadOutlined />}
                  href="http://127.0.0.1:8000/download_nde"
                  target="_blank"
                >
                  下载
                </Button>
              </div>
            )}

          </div>
        </>
      )}

    </Card>
  )
}