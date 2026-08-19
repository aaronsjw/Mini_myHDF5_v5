import React, { useState, useEffect, useRef, useMemo } from 'react'
import { Card, Slider, Button, Tag, InputNumber } from 'antd'
import ReactECharts from 'echarts-for-react'

const ABNORMAL_COLOR = '#f5222d'
const NORMAL_COLOR = '#1890ff'

const GRID_LEFT = 45
const GRID_RIGHT = 15
const GRID_TOP = 15 // 实际按 currentWave.length 动态计算

export default function AScanPlayer({ bscan, abnormalFrames, abnormalZones, keypoints }) {
    const [frameIndex, setFrameIndex] = useState(0)
    const [playing, setPlaying] = useState(false)
    const [playSpeed, setPlaySpeed] = useState(100)
    const playTimer = useRef(null)
    const containerRef = useRef(null)
    const [chartWidth, setChartWidth] = useState(600)

    const nFrames = bscan?.length || 0
    const currentWave = bscan?.[frameIndex] || []
    const isAbnormal = abnormalFrames?.includes(frameIndex) || false

    // 测量容器宽度
    useEffect(() => {
        const el = containerRef.current
        if (!el) return
        const measure = () => {
            const w = el.offsetWidth
            if (w > 0) setChartWidth(w)
        }
        measure()
        const ro = new ResizeObserver(measure)
        ro.observe(el)
        return () => ro.disconnect()
    }, [])

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

    // 计算异常峰值点的像素位置
    const annPosition = (() => {
        if (!isAbnormal || !abnormalZones?.length || !currentWave.length) return null
        const zone = abnormalZones[0]
        const seg = currentWave.slice(zone.start, zone.end)
        let peakIdx = zone.center
        if (seg.length > 0) {
            const abs = seg.map(v => Math.abs(v))
            peakIdx = zone.start + abs.indexOf(Math.max(...abs))
        }
        const n = currentWave.length
        const plotW = chartWidth - GRID_LEFT - GRID_RIGHT
        const x = GRID_LEFT + (peakIdx / (n - 1)) * plotW
        return { x, peakIdx }
    })()

    const markAreaData = !isAbnormal || !abnormalZones?.length ? [] : abnormalZones.map(z => [
        { xAxis: z.start },
        { xAxis: z.end, itemStyle: { color: 'rgba(245,34,45,0.25)' } },
    ])

    // 当前帧的界波和底波标注线
    const keypointLines = useMemo(() => {
        if (!keypoints || !keypoints[frameIndex]) return []
        const kp = keypoints[frameIndex]
        const lines = []
        if (kp.surface_peak > 0) {
            lines.push({
                xAxis: kp.surface_peak,
                lineStyle: { color: '#52c41a', type: 'dashed', width: 1.5 },
                label: { formatter: '界波', color: '#52c41a', fontSize: 10, fontWeight: 'bold' },
            })
        }
        if (kp.backwall_peak > 0) {
            lines.push({
                xAxis: kp.backwall_peak,
                lineStyle: { color: '#722ed1', type: 'dashed', width: 1.5 },
                label: { formatter: '底波', color: '#722ed1', fontSize: 10, fontWeight: 'bold' },
            })
        }
        return lines
    }, [keypoints, frameIndex])

    const waveformOption = {
        animation: false,
        tooltip: { trigger: 'axis', formatter: p => `幅值: ${p[0]?.value?.toFixed(1)}` },
        grid: { top: GRID_TOP, bottom: 20, left: GRID_LEFT, right: GRID_RIGHT },
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
            lineStyle: { width: 1.5, color: NORMAL_COLOR },
            areaStyle: {
                color: {
                    type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
                    colorStops: [
                        { offset: 0, color: NORMAL_COLOR + '30' },
                        { offset: 1, color: NORMAL_COLOR + '05' },
                    ],
                },
            },
            data: currentWave,
            markArea: markAreaData.length > 0 ? { silent: true, data: markAreaData } : undefined,
            markLine: keypointLines.length > 0 ? { symbol: 'none', silent: true, data: keypointLines } : undefined,
        }],
    }

    return (
        <>
            {currentWave.length > 0 && (
                <Card style={{ marginBottom: 12 }}>
                    <div ref={containerRef} style={{ position: 'relative' }}>
                        <ReactECharts option={waveformOption} style={{ height: 250 }} />

                        {/* 纯像素定位的标注浮层 */}
                        {annPosition && (
                            <div style={{
                                position: 'absolute',
                                left: annPosition.x,
                                top: 0,
                                transform: 'translateX(0)',
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
                                }}>
                                    <span style={{ color: '#fa8c16', fontSize: 13, fontWeight: 'bold' }}>⚠️</span> 异常
                                </div>
                                <div style={{
                                    width: 0, height: 0,
                                    borderTop: `8px solid ${ABNORMAL_COLOR}`,
                                    borderRight: '8px solid transparent',
                                    borderLeft: 0,
                                    marginTop: -1,
                                    marginLeft: 8,
                                }} />
                            </div>
                        )}
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
