import React from 'react'
import {
  Card,
  Slider,
  Button,
  Tag,
  InputNumber,
  Radio,
} from 'antd'

import ReactECharts from 'echarts-for-react'
import { DownloadOutlined } from '@ant-design/icons'

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

  // 逐帧逐帧标注
  frameLabels,
  onLabelChange,

}) {

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
              min:-2000,
              max:2000
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
              if (!frameLabels) return {}
              const m = {}
              frameLabels.forEach((v, i) => {
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
              value={playSpeed}
              onChange={v =>
                setPlaySpeed(v || 100)
              }
              addonAfter="ms"
              style={{ width: 120 }}
            />

            {frameLabels && frameLabels.length > 0 && (
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
                  value={frameLabels[frameIndex] !== undefined ? frameLabels[frameIndex] : -1}
                  onChange={e => onLabelChange && onLabelChange(frameIndex, e.target.value)}
                  size="small"
                >
                  {LABEL_OPTIONS.map(opt => (
                    <Radio.Button
                      key={opt.value}
                      value={opt.value}
                      style={opt.value === frameLabels[frameIndex] ? {
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