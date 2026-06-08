// App.jsx
import React, { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import HeatmapViewer from './components/HeatmapViewer'
import AScanViewer from './components/AScanViewer'
import MatrixViewer from './components/MatrixViewer'
import InspectPancel from './components/InspectPanel'
import DatabaseOverview from './components/DatabaseOverview'
import TrainingPanel from './components/TrainingPanel'
import TestingPanel from './components/TestingPanel'
import EvaluationPanel from './components/EvaluationPanel'

import {
    Layout,
    Upload,
    Button,
    Tree,
    Tag,
    Tabs,
    Select,
    Collapse
} from 'antd'

const { Sider, Content } = Layout

export default function App() {

    const [treeData, setTreeData] = useState([])
    const [info, setInfo] = useState(null)
    const [currentPath, setCurrentPath] = useState('')
    const [editableJson, setEditableJson] = useState(null)
    const [wave, setWave] = useState([])
    const [heatmap, setHeatmap] = useState(null)
    const [frames, setFrames] = useState([])
    const [frameIndex, setFrameIndex] = useState(0)
    const [currentFile, setCurrentFile] = useState('')
    const [colorMap, setColorMap] = useState('Greys')

    const [playing, setPlaying] = useState(false)
    const [playSpeed, setPlaySpeed] = useState(100)
    const playTimer = useRef(null)

    const [xDim, setXDim] = useState('D2')
    const [yDim, setYDim] = useState('D0')
    const [reverseX, setReverseX] = useState(false)
    const [reverseY, setReverseY] = useState(false)

    const [expandedKeys, setExpandedKeys] = useState([])
    const [batchDefectType, setBatchDefectType] = useState('OK')
    const [activeModule, setActiveModule] = useState('labeling')

    const heatmapHeight = heatmap
        ? Math.max(300, Math.min(heatmap.length * 6, 800))
        : 400

    // =========================================
    // Upload
    // =========================================
    const uploadFile = async (file) => {
        setInfo(null)
        setEditableJson(null)
        setWave([])
        setHeatmap(null)
        setFrames([])
        setFrameIndex(0)
        setTreeData([])
        setCurrentFile(file.name)

        const form = new FormData()
        form.append('file', file)

        await axios.post('http://127.0.0.1:8000/upload', form)

        if (file.name.toLowerCase().endsWith('.zip')) {
            setCurrentFile(file.name)
            return false
        }

        const res = await axios.get('http://127.0.0.1:8000/tree')
        setTreeData(res.data)
        setExpandedKeys(getAllKeys(res.data))
        return false
    }

    // =========================================
    // Upload 递归展开
    // =========================================
    const getAllKeys = (nodes) => {
        let keys = []
        nodes.forEach(node => {
            keys.push(node.key)
            if (node.children?.length) {
                keys = keys.concat(getAllKeys(node.children))
            }
        })
        return keys
    }

    // =========================================
    // Select Dataset
    // =========================================
    const onSelect = async (_, nodeInfo) => {
        const node = nodeInfo.node
        setCurrentPath(node.path)
        const res = await axios.get('http://127.0.0.1:8000/dataset', {
            params: { path: node.path }
        })
        const d = res.data
        setInfo(d)
        setEditableJson(d)
        setWave([])
        setHeatmap(null)
        setFrames([])

        if (d.type === 'waveform') setWave(d.data || [])
        if (d.type === 'image') setHeatmap(d.image)
        if (d.type === 'nde_tensor') {
            setFrames(d.bscan)
            setHeatmap(d.bscan)
            setWave(d.ascan)
            setFrameIndex(0)
        }
    }

    // =========================================
    // JSON Edit
    // =========================================
    const handleJsonEdit = (edit) => {
        setEditableJson(edit.updated_src)
        return true
    }

    const saveAsJson = () => {
        const blob = new Blob([JSON.stringify(editableJson, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'dataset.json'
        a.click()
        URL.revokeObjectURL(url)
    }

    // =========================================
    // A-Scan Auto Play
    // =========================================
    useEffect(() => {
        if (!playing) {
            clearInterval(playTimer.current)
            return
        }
        playTimer.current = setInterval(() => {
            setFrameIndex(prev => {
                const next = prev + 1
                if (next >= frames.length) {
                    setPlaying(false)
                    return 0
                }
                if (frames[next]) setWave(frames[next])
                return next
            })
        }, playSpeed)
        return () => clearInterval(playTimer.current)
    }, [playing, frames, playSpeed])

    // =========================================
    // Render
    // =========================================
    return (
        <Layout style={{ height: '100vh' }}>
            {/* LEFT SIDEBAR */}
            <Sider
                width={320}
                style={{
                    background: '#111',
                    padding: 0
                }}
            >
                <div
                    style={{
                        height: '100%',
                        display: 'flex',
                        flexDirection: 'column'
                    }}
                >
                    {/* Title */}
                    <div style={{
                        color: '#fff',
                        fontSize: 18,
                        fontWeight: 'bold',
                        textAlign: 'center',
                        padding: '20px 20px 0'
                    }}>
                        复合材料智能检测与评估系统
                    </div>

                    {/* Collapsible Panels */}
                    <div style={{ flex: 1, overflow: 'auto' }}>
                        <Collapse
                            defaultActiveKey={['labeling']}
                            activeKey={[activeModule]}
                            onChange={keys => setActiveModule(keys[keys.length - 1])}
                            bordered={false}
                            ghost
                            items={[
                                {
                                    key: 'labeling',
                                    label: <span style={{ color: '#fff', fontWeight: 'bold', fontSize: 14 }}>数据标注</span>,
                                    children: (
                                        <div style={{ padding: '0 8px 6px', background: '#666', borderRadius: 6 }}>
                                            {/* Current File */}
                                            {currentFile && (
                                                <div style={{ marginBottom: 6, padding: '6px 0' }}>
                                                    <div style={{ color: '#999', fontSize: 11, marginBottom: 4 }}>Current File</div>
                                                    <Tag color="cyan" style={{ maxWidth: 260, whiteSpace: 'normal', wordBreak: 'break-all' }}>
                                                        {currentFile}
                                                    </Tag>
                                                </div>
                                            )}
                                            {/* Upload */}
                                            <div style={{ marginBottom: 6 }}>
                                                <Upload
                                                    accept=".nde, .h5, .hdf5, .csv, .zip"
                                                    beforeUpload={uploadFile}
                                                    showUploadList={false}
                                                    style={{ display: 'block' }}
                                                >
                                                    <Button type="primary" block size="small" style={{ height: 30 }}>
                                                        Upload NDE / HDF5 / CSV
                                                    </Button>
                                                </Upload>
                                            </div>

                                            {/* Dataset Tree */}
                                            <div style={{ marginBottom: 6 }}>
                                                <Tree
                                                    treeData={treeData}
                                                    onSelect={onSelect}
                                                    expandedKeys={expandedKeys}
                                                    onExpand={keys => setExpandedKeys(keys)}
                                                    style={{ background: '#666', color: '#fff' }}
                                                />
                                            </div>

                                            {/* Batch Label */}
                                            <div>
                                                <Select
                                                    value={batchDefectType}
                                                    onChange={setBatchDefectType}
                                                    style={{ width: '100%', marginBottom: 6, height: 30 }}
                                                    size="small"
                                                    options={[
                                                        { value: 'OK', label: 'OK' },
                                                        { value: 'Dl', label: 'Dl' },
                                                        { value: 'Db', label: 'Db' },
                                                        { value: 'Po', label: 'Po' },
                                                        { value: 'Vo', label: 'Vo' },
                                                        { value: 'In', label: 'In' },
                                                        { value: 'Fb', label: 'Fb' },
                                                        { value: 'Rs', label: 'Rs' },
                                                        { value: 'Uc', label: 'Uc' }
                                                    ]}
                                                />
                                                <Button
                                                    type="primary"
                                                    block
                                                    size="small"
                                                    style={{ height: 30 }}
                                                    onClick={async () => {
                                                        try {
                                                            const form = new FormData()
                                                            form.append('defectType', batchDefectType)
                                                            const res = await axios.post(
                                                                'http://127.0.0.1:8000/batch_save_defect_type',
                                                                form,
                                                                { responseType: 'blob' }
                                                            )
                                                            const url = window.URL.createObjectURL(new Blob([res.data]))
                                                            const a = document.createElement('a')
                                                            a.href = url
                                                            a.download = `batch_${batchDefectType}.zip`
                                                            a.click()
                                                        } catch (err) {
                                                            console.error(err)
                                                            alert(err.message)
                                                        }
                                                    }}
                                                >
                                                    Apply To ZIP
                                                </Button>
                                            </div>
                                        </div>
                                    )
                                },
                                {
                                    key: 'dataset',
                                    label: <span style={{ color: '#fff', fontWeight: 'bold', fontSize: 14 }}>数据库</span>,
                                    children: (
                                        <div style={{ padding: '6px 12px', color: '#666', fontSize: 13, background: '#666', borderRadius: 6 }}>
                                            (Coming soon)
                                        </div>
                                    )
                                },
                                {
                                    key: 'model',
                                    label: <span style={{ color: '#fff', fontWeight: 'bold', fontSize: 14 }}>模型训练</span>,
                                    children: (
                                        <div style={{ padding: '6px 12px', color: '#666', fontSize: 13, background: '#666', borderRadius: 6 }}>
                                            (Coming soon)
                                        </div>
                                    )
                                },
                                {
                                    key: 'test',
                                    label: <span style={{ color: '#fff', fontWeight: 'bold', fontSize: 14 }}>模型测试</span>,
                                    children: (
                                        <div style={{ padding: '6px 12px', color: '#999', fontSize: 12, background: '#666', borderRadius: 6 }}>
                                            在测试数据集上评估模型
                                        </div>
                                    )
                                },
                                {
                                    key: 'analysis',
                                    label: <span style={{ color: '#fff', fontWeight: 'bold', fontSize: 14 }}>智能评估</span>,
                                    children: (
                                        <div style={{ padding: '6px 12px', color: '#999', fontSize: 12, background: '#666', borderRadius: 6 }}>
                                            上传 .nde 文件，用 AI 分析缺陷类型
                                        </div>
                                    )
                                }
                            ]}
                        />
                    </div>

                    {/* Footer */}
                    <div style={{
                        textAlign: 'center',
                        color: '#666',
                        fontSize: 12,
                        lineHeight: 1.6,
                        padding: '10px 20px 16px',
                        borderTop: '1px solid #222'
                    }}>
                        Mini_myHDF5 V5
                        <br />
                        Made by Aaron at ZHFC
                    </div>
                </div>
            </Sider>


            {/* RIGHT CONTENT */}
            <Content style={{ padding: 20, overflow: 'hidden', background: '#f5f5f5', position: 'relative' }}>
                {/* 用 display:none 替代条件渲染，防止组件卸载导致状态丢失 */}
                <div style={{ height: '100%', overflow: 'auto', display: activeModule === 'model' ? 'block' : 'none' }}>
                    <TrainingPanel />
                </div>
                <div style={{ height: '100%', overflow: 'auto', display: activeModule === 'dataset' ? 'block' : 'none' }}>
                    <DatabaseOverview />
                </div>
                <div style={{ height: '100%', overflow: 'auto', display: activeModule === 'test' ? 'block' : 'none' }}>
                    <TestingPanel />
                </div>
                <div style={{ height: '100%', display: activeModule === 'analysis' ? 'block' : 'none' }}>
                    <EvaluationPanel />
                </div>
                <div style={{ height: '100%', display: activeModule === 'labeling' ? 'block' : 'none' }}>
                    {info && (
                        <Tabs
                            defaultActiveKey="display"
                            tabBarStyle={{ color: '#fff', background: '#fff', padding: '8px 12px', borderRadius: '8px' }}

                            items={[
                                {
                                    key: 'inspect',
                                    label: 'Inspect',
                                    children: (
                                        <InspectPancel
                                            info={info}
                                            editableJson={editableJson}
                                            handleJsonEdit={handleJsonEdit}
                                            saveAsJson={saveAsJson}
                                            currentPath={currentPath}
                                        />
                                    )
                                },

                                ...(['waveform', 'nde_tensor'].includes(info.type)
                                    ? [{
                                        key: 'display',
                                        label: 'Display',
                                        children: (
                                            <Tabs
                                                defaultActiveKey="heatmap"
                                                items={[
                                                    {
                                                        key: 'matrix',
                                                        label: 'Matrix',
                                                        children: <MatrixViewer frames={frames} />
                                                    },
                                                    {
                                                        key: 'ascan',
                                                        label: 'A-Scan',
                                                        children: (
                                                            <AScanViewer
                                                                frames={frames}
                                                                wave={wave}
                                                                frameIndex={frameIndex}
                                                                setFrameIndex={setFrameIndex}
                                                                setWave={setWave}
                                                                playing={playing}
                                                                setPlaying={setPlaying}
                                                                playSpeed={playSpeed}
                                                                setPlaySpeed={setPlaySpeed}
                                                            />
                                                        )
                                                    },
                                                    {
                                                        key: 'heatmap',
                                                        label: 'Heatmap',
                                                        children: (
                                                            <HeatmapViewer
                                                                heatmap={heatmap}
                                                                colorMap={colorMap}
                                                                setColorMap={setColorMap}
                                                                heatmapHeight={heatmapHeight}
                                                                xDim={xDim}
                                                                setXDim={setXDim}
                                                                yDim={yDim}
                                                                setYDim={setYDim}
                                                                reverseX={reverseX}
                                                                setReverseX={setReverseX}
                                                                reverseY={reverseY}
                                                                setReverseY={setReverseY}
                                                            />
                                                        )
                                                    }
                                                ]}
                                            />
                                        )
                                    }]
                                    : [])
                            ]}
                        />
                    )}
                </div>
            </Content>
        </Layout>
    )
}