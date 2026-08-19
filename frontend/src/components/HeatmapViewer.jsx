import React, { useMemo } from 'react'
import {
    Card,
    Button,
    Select,
    Space
} from 'antd'
import ReactECharts from 'echarts-for-react'

export default function HeatmapViewer({
    heatmap,
    colorMap, setColorMap,
    heatmapHeight,
    xDim, setXDim,
    yDim, setYDim,
    reverseX, setReverseX,
    reverseY, setReverseY
}) {

    // =========================================
    // Display Matrix
    // =========================================
    const displayHeatmap = useMemo(() => {
        if (!heatmap || !heatmap.length) return null

        let matrix = heatmap

        // D0 ↔ D2 转置
        if (xDim === 'D0' && yDim === 'D2') {
            const rows = heatmap.length
            const cols = heatmap[0].length
            matrix = Array.from({ length: cols }, (_, x) =>
                Array.from({ length: rows }, (_, y) => heatmap[y][x])
            )
        }

        // Y Reverse
        if (reverseY) matrix = [...matrix].reverse()

        // X Reverse
        if (reverseX) matrix = matrix.map(row => [...row].reverse())

        return matrix
    }, [heatmap, xDim, yDim, reverseX, reverseY])

    // =========================================
    // Axis Select Logic
    // =========================================
    const handleXDimChange = (value) => {
        if (value === yDim) {
            const dims = ['D0', 'D1', 'D2']
            const remain = dims.find(d => d !== value && d !== xDim)
            setYDim(remain)
        }
        setXDim(value)
    }

    const handleYDimChange = (value) => {
        if (value === xDim) {
            const dims = ['D0', 'D1', 'D2']
            const remain = dims.find(d => d !== value && d !== yDim)
            setXDim(remain)
        }
        setYDim(value)
    }

    // =========================================
    // Colormap
    // =========================================
    const getVisualMapColors = () => {
        switch (colorMap) {
            case 'Viridis': return ['#440154', '#3b528b', '#21918c', '#5dc863', '#fde725']
            case 'Inferno': return ['#000004', '#420a68', '#932667', '#dd513a', '#fba40a', '#fcffa4']
            case 'Turbo':   return ['#30123b', '#4145ab', '#4693ff', '#39d353', '#f9e721', '#ff6b00', '#7a0403']
            case 'Plasma':  return ['#0d0887', '#7e03a8', '#cc4778', '#f89540', '#f0f921']
            case 'Magma':   return ['#000004', '#3b0f70', '#8c2981', '#de4968', '#fe9f6d', '#fcfdbf']
            default:        return ['#000000', '#555555', '#aaaaaa', '#ffffff']
        }
    }

    if (!displayHeatmap || displayHeatmap.length === 0) return null

    return (
        <Card
            title="B-Scan Heatmap"
            extra={
                <Select
                    value={colorMap}
                    style={{ width: 140 }}
                    onChange={setColorMap}
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
        >
            {/* Axis Controls */}
            <Space wrap style={{ marginBottom: 12 }}>
                <span>X:</span>
                <Button size="small" type={xDim === 'D0' ? 'primary' : 'default'} onClick={() => handleXDimChange('D0')}>D0</Button>
                <Button size="small" type={xDim === 'D1' ? 'primary' : 'default'} onClick={() => handleXDimChange('D1')}>D1</Button>
                <Button size="small" type={xDim === 'D2' ? 'primary' : 'default'} onClick={() => handleXDimChange('D2')}>D2</Button>
                <Button size="small" type={reverseX ? 'primary' : 'default'} onClick={() => setReverseX(!reverseX)}>Reverse X</Button>

                <span style={{ marginLeft: 20 }}>Y:</span>
                <Button size="small" type={yDim === 'D0' ? 'primary' : 'default'} onClick={() => handleYDimChange('D0')}>D0</Button>
                <Button size="small" type={yDim === 'D1' ? 'primary' : 'default'} onClick={() => handleYDimChange('D1')}>D1</Button>
                <Button size="small" type={yDim === 'D2' ? 'primary' : 'default'} onClick={() => handleYDimChange('D2')}>D2</Button>
                <Button size="small" type={reverseY ? 'primary' : 'default'} onClick={() => setReverseY(!reverseY)}>Reverse Y</Button>
            </Space>

            <ReactECharts
                option={{
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
                        inRange: { color: getVisualMapColors() }
                    },
                    xAxis: {
                        type: 'category',
                        data: reverseX
                            ? displayHeatmap[0].map((_, i) => i).filter(i => i % 8 === 0).reverse()
                            : displayHeatmap[0].map((_, i) => i).filter(i => i % 8 === 0)
                    },
                    yAxis: {
                        type: 'category',
                        data: reverseY
                            ? displayHeatmap.map((_, i) => i).reverse()
                            : displayHeatmap.map((_, i) => i)
                    },
                    series: [{
                        type: 'heatmap',
                        progressive: 5000,
                        data: displayHeatmap.flatMap((row, y) =>
                            row.filter((_, x) => x % 8 === 0).map((v, x) => [x, y, v])
                        )
                    }]
                }}
                style={{ height: heatmapHeight }}
            />
        </Card>
    )
}