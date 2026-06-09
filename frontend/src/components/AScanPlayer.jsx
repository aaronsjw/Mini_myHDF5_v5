import React, { useState, useEffect, useRef } from 'react'
import { Card, Slider, Button, Tag, InputNumber } from 'antd'
import ReactECharts from 'echarts-for-react'

const ABNORMAL_COLOR = '#f5222d'
const NORMAL_COLOR = '#1890ff'

export default function AScanPlayer({ bscan, abnormalFrames, abnormalZones }) {
  const [frameIndex, setFrameIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [playSpeed, setPlaySpeed] = useState(100)
  const playTimer = useRef(null)

  const nFrames = bscan?.length || 0
  const totalPoints = bscan?.[0]?.length || 2000  // 采样点数
  const currentWave = bscan?.[frameIndex] || []
  const isAbnormal = abnormalFrames?.includes(frameIndex) || false
  const waveColor = isAbnormal ? ABNORMAL_COLOR : NORMAL_COLOR

  useEffect(() => {
    if (!playing) { clearInterval(playTimer.current); return }
    playTimer.current = setInterval(() => {
      setFrameIndex(prev => {
        if (prev + 1 >= nFrames) { setPlaying(false); return 0 }
        return prev + 1
      })
    }, playSpeed)
    return () => clearInterval(playTimer.current)
  }, [playing, nFrames, playSpeed])

  const updateFrame = (idx) => { setFrameIndex(idx); setPlaying(false) }

  const abnormalMarks = {}
  if (abnormalFrames?.length > 0) {
    abnormalFrames.forEach(idx => {
      abnormalMarks[idx] = {
        style: { color: ABNORMAL_COLOR, fontSize: 16, lineHeight: '8px' },
        label: '●',
      }
    })
  }

  // 计算当前帧每个异常区域的峰值位置（用于定位标注）
  const currentAnnotations = (() => {
    if (!isAbnormal || !abnormalZones?.length) return []
    return abnormalZones.map(zone => {
      const seg = currentWave.slice(zone.start, zone.end)
      let peakIdx = zone.center
      if (seg.length > 0) {
        const abs = seg.map(v => Math.abs(v))
        peakIdx = zone.start + abs.indexOf(Math.max(...abs))
      }
      return {
        ...zone,
        peakIdx,
        // x 轴百分比位置（相对于 2000 个采样点）
        xPct: (peakIdx / totalPoints) * 100,
      }
    })
  })()

  // 红色背景区域（ECharts 实现）
  const markAreaData = !isAbnormal || !abnormalZones?.length ? [] : abnormalZones.map(z => [
    { xAxis: z.start },
    { xAxis: z.end, itemStyle: { color: 'rgba(245,34,45,0.08)' } },
  ])

  const waveformOption = {
    animation: false,
    tooltip: { trigger: 'axis', formatter: p => `幅值: ${p[0]?.value?.toFixed(1)}` },
    grid: { top: 5, bottom: 20, left: 45, right: 15 },
    xAxis: {
      type: 'category',
      data: currentWave.map((_, i) => i),
      axisLabel: { fontSize: 9, color: '#999', interval: 200 },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value', min: -2000, max: 2000,
      splitLine: { lineStyle: { color: '#f0f0f0', type: 'dashed' } },
      axisLabel: { fontSize: 10, color: '#999' },
    },
    series: [{
      type: 'line', smooth: true, showSymbol: false,
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
      markArea: markAreaData.length > 0 ? { silent: true, data: markAreaData } : undefined,
    }],
  }

  return (
    <>
      {currentWave.length > 0 && (
        <Card style={{ marginBottom: 12 }}>
          <div style={{ position: 'relative' }}>
            <ReactECharts option={waveformOption} style={{ height: 250 }} />

            {/* HTML 浮层标注 */}
            {currentAnnotations.map((ann, i) => (
              <div key={i} style={{
                position: 'absolute',
                left: `${ann.xPct}%`,
                top: 0,
                transform: 'translateX(-50%)',
                pointerEvents: 'none',
                zIndex: 10,
              }}>
                <div style={{
                  background: 'rgba(255,255,255,0.93)',
                  border: `1px solid ${ABNORMAL_COLOR}`,
                  borderRadius: 4,
                  padding: '2px 8px',
                  fontSize: 11,
                  lineHeight: 1.5,
                  color: '#333',
                  whiteSpace: 'nowrap',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                }}>
                  ⚠ {ann.desc}
                </div>
                <div style={{
                  display: 'flex', justifyContent: 'center', height: 6,
                }}>
                  <div style={{
                    width: 0, height: 0,
                    borderLeft: '5px solid transparent',
                    borderRight: '5px solid transparent',
                    borderTop: `6px solid ${ABNORMAL_COLOR}`,
                  }} />
                </div>
              </div>
            ))}
          </div>

          {nFrames > 0 && (
            <div style={{ marginTop: 12 }}>
              <Slider
                min={0} max={nFrames - 1}
                value={frameIndex} onChange={updateFrame}
                marks={abnormalMarks}
                tooltip={{ formatter: v => `帧 ${v + 1}` }}
              />
              <div style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'center' }}>
                <Button onClick={() => updateFrame(Math.max(frameIndex - 1, 0))}>Prev</Button>
                <Button type="primary" onClick={() => setPlaying(true)}>▶ Play</Button>
                <Button danger onClick={() => setPlaying(false)}>■ Stop</Button>
                <Button onClick={() => updateFrame(Math.min(frameIndex + 1, nFrames - 1))}>Next</Button>
                <Tag color={isAbnormal ? 'red' : 'blue'}>{frameIndex + 1}/{nFrames}</Tag>
                <InputNumber min={20} max={1000} value={playSpeed} onChange={v => setPlaySpeed(v || 100)} addonAfter="ms" />
              </div>
            </div>
          )}
        </Card>
      )}
    </>
  )
}
