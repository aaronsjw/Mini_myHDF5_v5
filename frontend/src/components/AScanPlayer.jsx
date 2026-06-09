import React, { useState, useEffect, useRef } from 'react'
import { Card, Slider, Button, Tag, InputNumber } from 'antd'
import ReactECharts from 'echarts-for-react'

const ABNORMAL_COLOR = '#f5222d'
const NORMAL_COLOR = '#1890ff'

export default function AScanPlayer({ bscan, abnormalFrames }) {
  const [frameIndex, setFrameIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [playSpeed, setPlaySpeed] = useState(100)
  const playTimer = useRef(null)

  const nFrames = bscan?.length || 0
  const currentWave = bscan?.[frameIndex] || []
  const isAbnormal = abnormalFrames?.includes(frameIndex) || false
  const waveColor = isAbnormal ? ABNORMAL_COLOR : NORMAL_COLOR

  // 播放定时器
  useEffect(() => {
    if (!playing) {
      clearInterval(playTimer.current)
      return
    }
    playTimer.current = setInterval(() => {
      setFrameIndex(prev => {
        const next = prev + 1
        if (next >= nFrames) {
          setPlaying(false)
          return 0
        }
        return next
      })
    }, playSpeed)
    return () => clearInterval(playTimer.current)
  }, [playing, nFrames, playSpeed])

  const updateFrame = (idx) => {
    setFrameIndex(idx)
    setPlaying(false)
  }

  // 异常帧标记：用 Slider marks 精准对齐帧位置
  const abnormalMarks = {}
  if (abnormalFrames && abnormalFrames.length > 0) {
    abnormalFrames.forEach(idx => {
      abnormalMarks[idx] = {
        style: { color: ABNORMAL_COLOR, fontSize: 16, lineHeight: '8px' },
        label: '●',
      }
    })
  }

  const waveformOption = {
    animation: false,
    tooltip: {
      trigger: 'axis',
      formatter: params => {
        const p = params[0]
        return `采样点: ${p.dataIndex}<br/>幅值: ${p.value?.toFixed(1)}`
      },
    },
    grid: { top: 10, bottom: 20, left: 50, right: 20 },
    xAxis: {
      type: 'category',
      data: currentWave.map((_, i) => i),
    },
    yAxis: {
      type: 'value',
      min: -2000,
      max: 2000,
    },
    series: [
      {
        type: 'line',
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 1.5, color: waveColor },
        areaStyle: {
          color: {
            type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: waveColor + '30' },
              { offset: 1, color: waveColor + '05' },
            ],
          },
        },
        data: currentWave,
      },
    ],
  }

  return (
    <>
      {currentWave.length > 0 && (
        <Card
          style={{ marginBottom: 12 }}
        >
          <ReactECharts option={waveformOption} style={{ height: 250 }} />

          {nFrames > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ position: 'relative' }}>
                <Slider
                  min={0}
                  max={nFrames - 1}
                  value={frameIndex}
                  onChange={updateFrame}
                  marks={abnormalMarks}
                  tooltip={{ formatter: v => `帧 ${v + 1}` }}
                />
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 16, alignItems: 'center' }}>
                <Button onClick={() => updateFrame(Math.max(frameIndex - 1, 0))}>
                  Prev
                </Button>
                <Button type="primary" onClick={() => setPlaying(true)}>
                  ▶ Play
                </Button>
                <Button danger onClick={() => setPlaying(false)}>
                  ■ Stop
                </Button>
                <Button onClick={() => updateFrame(Math.min(frameIndex + 1, nFrames - 1))}>
                  Next
                </Button>

                <Tag color={isAbnormal ? 'red' : 'blue'}>
                  {frameIndex + 1}/{nFrames}
                </Tag>

                <InputNumber
                  min={20}
                  max={1000}
                  value={playSpeed}
                  onChange={v => setPlaySpeed(v || 100)}
                  addonAfter="ms"
                />
              </div>
            </div>
          )}
        </Card>
      )}
    </>
  )
}
