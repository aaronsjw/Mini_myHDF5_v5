import React, { useState } from 'react'
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

  // 更新标签（同时更新本地状态和后端）
  const updateLabel = (idx, val) => {
    setLocalLabels(prev => {
      const next = prev ? [...prev] : new Array(frames?.length || 64).fill(-1)
      next[idx] = val
      return next
    })
    if (onLabelChange) onLabelChange(idx, val)
  }

  const updateFrame = idx => {
    setFrameIndex(idx)
    if (frames[idx]) {
      setWave(frames[idx])
    }
  }

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
              if (!effectiveLabels) return {}
              const m = {}
              effectiveLabels.forEach((v, i) => {
                if (v === 0) m[i] = <span style={{ fontSize: 16, lineHeight: '14px', color: '#52c41a' }}>●</span>
                else if (v > 0) m[i] = <span style={{ fontSize: 16, lineHeight: '14px', color: '#f5222d' }}>●</span>
              })
              return m
            })()}
          />

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
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
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