//***** App.jsx
import React, { useState, useEffect, useRef } from 'react'
import axios from 'axios'   // HTTP请求库，用于和后端FastAPI通信

import HeatmapViewer from './components/HeatmapViewer'
import AScanViewer from './components/AScanViewer'
import MatrixViewer from './components/MatrixViewer'
import InspectPanel from './components/InspectPanel'
import DatabaseOverview from './components/DatabaseOverview'
import TrainingPanel from './components/TrainingPanel'
import TestingPanel from './components/TestingPanel'
import EvaluationPanel from './components/EvaluationPanel'
import CScanLabeler from './components/CScanLabeler'
import DatasetTree from './components/DatasetTree'
import CScanTrainPanel from './components/CScanTrainPanel'
import CScanTestPanel from './components/CScanTestPanel'
import { RUNNABLE_ASCAN, CSCAN_DATASET, findDataset } from './datasets'
import Structure3DViewer from './components/Structure3DViewer'

import {
    Layout,
    Upload,
    Button,
    Tree,
    Tag,
    Tabs,
    Select,
    Collapse
} from 'antd'       // UI组件库

// =========================================
// 状态声明
// =========================================
const { Sider, Content } = Layout

export default function App() {
    const [treeData, setTreeData] = useState([])            // 文件树结构
    const [info, setInfo] = useState(null)                  // 当前选中文件的元信息
    const [currentPath, setCurrentPath] = useState('')
    const [editableJson, setEditableJson] = useState(null)
    const [wave, setWave] = useState([])                    // A-Scan波形数据
    const [heatmap, setHeatmap] = useState(null)            // B-Scan二维图数据
    const [frames, setFrames] = useState([])                // 多帧波形
    const [frameIndex, setFrameIndex] = useState(0)
    const [currentFile, setCurrentFile] = useState('')
    const [colorMap, setColorMap] = useState('Greys')
    const [activeViewTab, setActiveViewTab] = useState('inspect')   // Inspect/Display 外层Tabs激活页

    // 节点切换或类型变化时自动定位激活页：可显示波形/张量的节点→Display，否则→Inspect
    useEffect(() => {
        const disp = info && ['waveform', 'nde_tensor'].includes(info.type)
        setActiveViewTab(disp ? 'display' : 'inspect')
    }, [currentPath, info])

    const [playing, setPlaying] = useState(false)           // 是否自动播放
    const [playSpeed, setPlaySpeed] = useState(80)
    const playTimer = useRef(null)

    const [xDim, setXDim] = useState('D2')
    const [yDim, setYDim] = useState('D0')
    const [reverseX, setReverseX] = useState(false)
    const [reverseY, setReverseY] = useState(false)

    const [expandedKeys, setExpandedKeys] = useState([])            // 组件Tree展开状态
    const [batchDefectType, setBatchDefectType] = useState('OK')
    const [activeModule, setActiveModule] = useState('labeling')
    const [frameLabels, setFrameLabels] = useState(null)            // 每帧的标注类别
    const [yAxisRange, setYAxisRange] = useState([-100, 100])
    const [datasetPath, setDatasetPath] = useState('')              // 数据库子目录路径
    const [imageSession, setImageSession] = useState(null)          // 上传 CScan 原图 → 标注会话 {file,name}
    const [trainPath, setTrainPath] = useState(RUNNABLE_ASCAN)      // 模型训练选中的数据集
    const [testPath, setTestPath] = useState(RUNNABLE_ASCAN)        // 模型测试选中的数据集

    // 数据库 分组展开状态（每组箭头可点开/折叠，独立）
    const [dbOpen, setDbOpen] = useState({
        ultrasonic: true, radiography: false, optical: false, electromagnetic: false,
    })
    const toggleDbGroup = (g) => setDbOpen(p => ({ ...p, [g]: !p[g] }))
    useEffect(() => {
        if (!datasetPath) return
        const g = datasetPath.split('/')[0]
        setDbOpen(p => (p[g] ? p : { ...p, [g]: true }))
    }, [datasetPath])

    const heatmapHeight = heatmap
        ? Math.max(300, Math.min(heatmap.length * 6, 800))
        : 400

    // =========================================
    // 文件上传
    // =========================================
    const uploadFile = async (file) => {
        // 1.清空旧数据
        setInfo(null)
        setEditableJson(null)
        setWave([])
        setHeatmap(null)
        setFrames([])
        setFrameIndex(0)
        setTreeData([])
        setCurrentFile(file.name)
        setFrameLabels(null)
        setImageSession(null)

        // CScan 原图（bmp/png/jpg/jpeg）→ 进入标注入库界面，不做 .nde 树解析
        const _ext = (file.name.split('.').pop() || '').toLowerCase()
        if (['bmp', 'png', 'jpg', 'jpeg'].includes(_ext)) {
            setImageSession({ file, name: file.name })
            return false
        }

        // 2.用FormData包装文件，发送POST请求
        const form = new FormData()
        form.append('file', file)

        // 前端-》后端
        await axios.post('http://127.0.0.1:8000/upload', form)

        // zip
        if (file.name.toLowerCase().endsWith('.zip')) {
            setCurrentFile(file.name)
            return false
        }

        // 3.文件树
        const res = await axios.get('http://127.0.0.1:8000/tree')   // GET内部结构树
        setTreeData(res.data)                   // 渲染树
        setExpandedKeys(getAllKeys(res.data))   // 展开树
        return false
    }

    // =========================================
    // Upload JSON递归展开
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
    // Select Dataset 选择文件节点，点击树节点触发
    // =========================================
    const onSelect = async (_, nodeInfo) => {
        const node = nodeInfo.node
        setCurrentPath(node.path)
        // 根据节点类型设置 y 轴范围
        if (node.path && node.path.includes('FrameLabels')) {
            setYAxisRange([-10, 10])
        } else {
            setYAxisRange([-100, 100])
        }
        // 请求该节点数据
        const res = await axios.get('http://127.0.0.1:8000/dataset', {
            params: { path: node.path }
        })
        const d = res.data
        setInfo(d)
        setEditableJson(d)
        setWave([])
        setHeatmap(null)
        setFrames([])

        // 根据数据类型设置wave/heatmap/frames
        if (d.type === 'waveform') setWave(d.data || [])
        if (d.type === 'image') setHeatmap(d.image)
        if (d.type === 'nde_tensor') {
            setFrames(d.bscan)
            setHeatmap(d.bscan)
            setWave(d.ascan)
            setFrameIndex(0)
            // 首次加载从后端拉取；已有标注则复用内存
            if (frameLabels === null) {
                axios.get('http://127.0.0.1:8000/get_frame_labels')
                    .then(res => {
                        if (res.data && res.data.labels) setFrameLabels(res.data.labels)
                    })
                    .catch(() => setFrameLabels(new Array(d.bscan.length).fill(-1)))
            }
        }
    }

    // =========================================
    // 标注保存
    // =========================================
    const handleSaveFrameLabel = (frameIdx, labelId) => {
        // 先改UI
        setFrameLabels(prev => {
            const base = prev || new Array(frames.length || 64).fill(-1)
            const next = [...base]
            next[frameIdx] = labelId
            return next
        })
        axios.post('http://127.0.0.1:8000/save_frame_label', {
            frame_index: frameIdx,
            label_id: labelId,
        }).catch(err => {
            console.error('保存帧标签失败:', err)
        })
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
    // 控制自动播放 A-Scan Auto Play
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
    // 渲染部分 JSX Render
    // =========================================
    return (
        <Layout style={{ height: '100vh' }}>

            {/* LEFT SIDEBAR 左侧菜单 */}
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
                        padding: '20px 20px 20px'
                    }}>
                        复合材料智能检测与评估系统
                    </div>

                    {/* Collapsible Panels 折叠面板，五个菜单项（数据标注、数据库、模型训练、模型测试、智能评估） */}
                    <div style={{ flex: 1, overflow: 'hidden' }}>
                        <Collapse
                            defaultActiveKey={['labeling']}
                            activeKey={[activeModule]}
                            onChange={keys => setActiveModule(keys[keys.length - 1])}
                            bordered={false}
                            ghost
                            items={[

                                // 数据标注面板
                                {
                                    key: 'labeling',
                                    label: <span style={{ color: '#fff', fontWeight: 'bold', fontSize: 14 }}>数据标注</span>,
                                    children: (
                                        <div style={{ padding: '8px', background: '#666', borderRadius: 6, display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 180px)' }}>
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
                                                    accept=".nde, .h5, .hdf5, .csv, .zip, .bmp, .png, .jpg, .jpeg"
                                                    beforeUpload={uploadFile}
                                                    showUploadList={false}
                                                    style={{ display: 'block' }}
                                                >
                                                    <Button type="primary" block size="small" style={{ height: 30 }}>
                                                        Upload NDE/CSV/ZIP
                                                    </Button>
                                                </Upload>
                                            </div>

                                            {/* Dataset Tree */}
                                            <div style={{ flex: 1, overflow: 'auto', marginBottom: 6 }}>
                                                <Tree
                                                    treeData={treeData}
                                                    onSelect={onSelect}
                                                    expandedKeys={expandedKeys}
                                                    onExpand={keys => setExpandedKeys(keys)}
                                                    style={{ background: '#666', color: '#fff' }}
                                                />
                                            </div>

                                            {/* Batch Label */}
                                            <div style={{ display: 'flex', gap: 6 }}>
                                                <Select
                                                    value={batchDefectType}
                                                    onChange={setBatchDefectType}
                                                    style={{ flex: 1, height: 30 }}
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
                                                    size="small"
                                                    style={{ height: 30, width: 130, flexShrink: 0 }}
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
                                // 数据库面板
                                {
                                    key: 'dataset',
                                    label: <span style={{ color: '#fff', fontWeight: 'bold', fontSize: 14 }}>数据库</span>,
                                    children: (
                                        <div style={{ padding: '4px 0', background: '#666', borderRadius: 6 }}>
                                            {/* 超声检测 */}
                                            <div style={{ marginBottom: 4 }}>
                                                <div
                                                    onClick={() => toggleDbGroup('ultrasonic')}
                                                    style={{
                                                        padding: '6px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 'bold',
                                                        color: dbOpen.ultrasonic ? '#1890ff' : '#ccc',
                                                        borderRadius: 4, userSelect: 'none',
                                                    }}
                                                >
                                                    <span style={{ display: 'inline-block', width: 14 }}>{dbOpen.ultrasonic ? '▾' : '▸'}</span>超声检测
                                                </div>
                                                {dbOpen.ultrasonic && (
                                                    <div style={{ paddingLeft: 24 }}>
                                                        <div
                                                            onClick={() => { setActiveModule('dataset'); setDatasetPath('ultrasonic/ascan') }}
                                                            style={{
                                                                padding: '6px 12px', cursor: 'pointer', fontSize: 13,
                                                                color: datasetPath === 'ultrasonic/ascan' ? '#1890ff' : '#fff',
                                                                background: datasetPath === 'ultrasonic/ascan' ? 'rgba(24,144,255,0.15)' : 'transparent',
                                                                borderRadius: 4,
                                                            }}
                                                        >
                                                             超声 AScan 数据库
                                                        </div>
                                                        <div
                                                            onClick={() => { setActiveModule('dataset'); setDatasetPath('ultrasonic/cscan') }}
                                                            style={{
                                                                padding: '6px 12px', cursor: 'pointer', fontSize: 13,
                                                                color: datasetPath === 'ultrasonic/cscan' ? '#1890ff' : '#fff',
                                                                background: datasetPath === 'ultrasonic/cscan' ? 'rgba(24,144,255,0.15)' : 'transparent',
                                                                borderRadius: 4,
                                                            }}
                                                        >
                                                             超声 CScan 数据库
                                                        </div>
                                                        <div
                                                            onClick={() => { setActiveModule('dataset'); setDatasetPath('ultrasonic/paut') }}
                                                            style={{
                                                                padding: '6px 12px', cursor: 'pointer', fontSize: 13,
                                                                color: datasetPath === 'ultrasonic/paut' ? '#1890ff' : '#fff',
                                                                background: datasetPath === 'ultrasonic/paut' ? 'rgba(24,144,255,0.15)' : 'transparent',
                                                                borderRadius: 4,
                                                            }}
                                                        >
                                                             超声相控阵 PAUT
                                                        </div>
                                                        <div
                                                            onClick={() => { setActiveModule('dataset'); setDatasetPath('ultrasonic/guidedwave') }}
                                                            style={{
                                                                padding: '6px 12px', cursor: 'pointer', fontSize: 13,
                                                                color: datasetPath === 'ultrasonic/guidedwave' ? '#1890ff' : '#fff',
                                                                background: datasetPath === 'ultrasonic/guidedwave' ? 'rgba(24,144,255,0.15)' : 'transparent',
                                                                borderRadius: 4,
                                                            }}
                                                        >
                                                             导波 GW
                                                        </div>
                                                        <div
                                                            onClick={() => { setActiveModule('dataset'); setDatasetPath('ultrasonic/ae') }}
                                                            style={{
                                                                padding: '6px 12px', cursor: 'pointer', fontSize: 13,
                                                                color: datasetPath === 'ultrasonic/ae' ? '#1890ff' : '#fff',
                                                                background: datasetPath === 'ultrasonic/ae' ? 'rgba(24,144,255,0.15)' : 'transparent',
                                                                borderRadius: 4,
                                                            }}
                                                        >
                                                             声发射 AE
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                            {/* 射线检测 */}
                                            <div style={{ marginBottom: 4 }}>
                                                <div
                                                    onClick={() => toggleDbGroup('radiography')}
                                                    style={{
                                                        padding: '6px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 'bold',
                                                        color: dbOpen.radiography ? '#1890ff' : '#ccc',
                                                        borderRadius: 4, userSelect: 'none',
                                                    }}
                                                >
                                                    <span style={{ display: 'inline-block', width: 14 }}>{dbOpen.radiography ? '▾' : '▸'}</span>射线检测
                                                </div>
                                                {dbOpen.radiography && (
                                                    <div style={{ paddingLeft: 24 }}>
                                                        <div
                                                            onClick={() => { setActiveModule('dataset'); setDatasetPath('radiography/dr') }}
                                                            style={{
                                                                padding: '6px 12px', cursor: 'pointer', fontSize: 13,
                                                                color: datasetPath === 'radiography/dr' ? '#1890ff' : '#fff',
                                                                background: datasetPath === 'radiography/dr' ? 'rgba(24,144,255,0.15)' : 'transparent',
                                                                borderRadius: 4,
                                                            }}
                                                        >
                                                             数字射线 DR
                                                        </div>
                                                        <div
                                                            onClick={() => { setActiveModule('dataset'); setDatasetPath('radiography/ict') }}
                                                            style={{
                                                                padding: '6px 12px', cursor: 'pointer', fontSize: 13,
                                                                color: datasetPath === 'radiography/ict' ? '#1890ff' : '#fff',
                                                                background: datasetPath === 'radiography/ict' ? 'rgba(24,144,255,0.15)' : 'transparent',
                                                                borderRadius: 4,
                                                            }}
                                                        >
                                                             工业 CT
                                                        </div>
                                                        <div
                                                            onClick={() => { setActiveModule('dataset'); setDatasetPath('radiography/terahertz') }}
                                                            style={{
                                                                padding: '6px 12px', cursor: 'pointer', fontSize: 13,
                                                                color: datasetPath === 'radiography/terahertz' ? '#1890ff' : '#fff',
                                                                background: datasetPath === 'radiography/terahertz' ? 'rgba(24,144,255,0.15)' : 'transparent',
                                                                borderRadius: 4,
                                                            }}
                                                        >
                                                             太赫兹
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                            {/* 光学检测 */}
                                            <div style={{ marginBottom: 4 }}>
                                                <div
                                                    onClick={() => toggleDbGroup('optical')}
                                                    style={{
                                                        padding: '6px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 'bold',
                                                        color: dbOpen.optical ? '#1890ff' : '#ccc',
                                                        borderRadius: 4, userSelect: 'none',
                                                    }}
                                                >
                                                    <span style={{ display: 'inline-block', width: 14 }}>{dbOpen.optical ? '▾' : '▸'}</span>光学检测
                                                </div>
                                                {dbOpen.optical && (
                                                    <div style={{ paddingLeft: 24 }}>
                                                        <div
                                                            onClick={() => { setActiveModule('dataset'); setDatasetPath('optical/vt') }}
                                                            style={{
                                                                padding: '6px 12px', cursor: 'pointer', fontSize: 13,
                                                                color: datasetPath === 'optical/vt' ? '#1890ff' : '#fff',
                                                                background: datasetPath === 'optical/vt' ? 'rgba(24,144,255,0.15)' : 'transparent',
                                                                borderRadius: 4,
                                                            }}
                                                        >
                                                             内窥镜 VT
                                                        </div>
                                                        <div
                                                            onClick={() => { setActiveModule('dataset'); setDatasetPath('optical/irt') }}
                                                            style={{
                                                                padding: '6px 12px', cursor: 'pointer', fontSize: 13,
                                                                color: datasetPath === 'optical/irt' ? '#1890ff' : '#fff',
                                                                background: datasetPath === 'optical/irt' ? 'rgba(24,144,255,0.15)' : 'transparent',
                                                                borderRadius: 4,
                                                            }}
                                                        >
                                                             红外热成像 IRT
                                                        </div>
                                                        <div
                                                            onClick={() => { setActiveModule('dataset'); setDatasetPath('optical/shearography') }}
                                                            style={{
                                                                padding: '6px 12px', cursor: 'pointer', fontSize: 13,
                                                                color: datasetPath === 'optical/shearography' ? '#1890ff' : '#fff',
                                                                background: datasetPath === 'optical/shearography' ? 'rgba(24,144,255,0.15)' : 'transparent',
                                                                borderRadius: 4,
                                                            }}
                                                        >
                                                             激光剪切散斑
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                            {/* 电磁检测 */}
                                            <div style={{ marginBottom: 4 }}>
                                                <div
                                                    onClick={() => toggleDbGroup('electromagnetic')}
                                                    style={{
                                                        padding: '6px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 'bold',
                                                        color: dbOpen.electromagnetic ? '#1890ff' : '#ccc',
                                                        borderRadius: 4, userSelect: 'none',
                                                    }}
                                                >
                                                    <span style={{ display: 'inline-block', width: 14 }}>{dbOpen.electromagnetic ? '▾' : '▸'}</span>电磁检测
                                                </div>
                                                {dbOpen.electromagnetic && (
                                                    <div style={{ paddingLeft: 24 }}>
                                                        <div
                                                            onClick={() => { setActiveModule('dataset'); setDatasetPath('electromagnetic/et') }}
                                                            style={{
                                                                padding: '6px 12px', cursor: 'pointer', fontSize: 13,
                                                                color: datasetPath === 'electromagnetic/et' ? '#1890ff' : '#fff',
                                                                background: datasetPath === 'electromagnetic/et' ? 'rgba(24,144,255,0.15)' : 'transparent',
                                                                borderRadius: 4,
                                                            }}
                                                        >
                                                             涡流 ET
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )
                                },
                                // 模型训练面板（子导航：选数据集）
                                {
                                    key: 'model',
                                    label: <span style={{ color: '#fff', fontWeight: 'bold', fontSize: 14 }}>模型训练</span>,
                                    children: (
                                        <div style={{ background: '#666', borderRadius: 6, padding: '4px 0' }}>
                                            <DatasetTree value={trainPath}
                                                onChange={(v) => { setTrainPath(v); setActiveModule('model') }} />
                                        </div>
                                    )
                                },
                                // 模型测试面板（子导航：选数据集）
                                {
                                    key: 'test',
                                    label: <span style={{ color: '#fff', fontWeight: 'bold', fontSize: 14 }}>模型测试</span>,
                                    children: (
                                        <div style={{ background: '#666', borderRadius: 6, padding: '4px 0' }}>
                                            <DatasetTree value={testPath}
                                                onChange={(v) => { setTestPath(v); setActiveModule('test') }} />
                                        </div>
                                    )
                                },
                                // 智能评估面板
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

                    {/* Footer 作者信息 */}
                    <div style={{
                        textAlign: 'center',
                        color: '#666',
                        fontSize: 12,
                        lineHeight: 1.6,
                        padding: '10px 20px 16px',
                        borderTop: '1px solid #222'
                    }}>
                        AI-NDE for Composites
                        <br />
                        Made by Aaron at FCZX
                    </div>
                </div>
            </Sider>

            {/* RIGHT CONTENT 右侧内容 */}
            <Content style={{ padding: 20, overflow: 'hidden', background: '#f5f5f5', position: 'relative' }}>
                {/* 模型训练 TrainingPanel ****************/}
                <div style={{ height: '100%', overflow: 'auto', display: activeModule === 'model' ? 'block' : 'none' }}>
                    {(() => {
                        if (trainPath === CSCAN_DATASET) return <CScanTrainPanel active={activeModule === 'model'} />
                        if (trainPath === RUNNABLE_ASCAN) return <TrainingPanel active={activeModule === 'model'} />
                        const leaf = findDataset(trainPath)
                        return (
                            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: '#999', fontSize: 16 }}>
                                {(leaf?.label?.split('（')[0] || trainPath)} · 训练界面暂空（待接入）
                            </div>
                        )
                    })()}
                </div>
                {/* 数据库预览 DatabaseOverview ****************/}
                <div style={{ height: '100%', overflow: 'auto', display: activeModule === 'dataset' ? 'block' : 'none' }}>
                    {(() => {
                        if (datasetPath === 'ultrasonic/ascan') return <DatabaseOverview />
                        if (datasetPath === 'ultrasonic/cscan') return (
                            <DatabaseOverview
                                endpoint="http://127.0.0.1:8000/cscan_dataset"
                                dirLabel="CScan 数据目录"
                                dirPath="dataset/cscan_dataset/raw"
                                mergeMaterial
                                imageUrlFn={filename => `http://127.0.0.1:8000/cscan/image?name=${encodeURIComponent(filename)}`}
                                extraColumns={[
                                    { title: '牌号', key: 'grade', width: 130, render: (_, r) => `${r.fiberGrade}/${r.matrixGrade}` },
                                ]}
                            />
                        )
                        const placeholderMap = {
                            'ultrasonic/paut': '超声相控阵 PAUT（待开发）',
                            'ultrasonic/guidedwave': '导波 GW（待开发）',
                            'ultrasonic/ae': '声发射 AE（待开发）',
                            'radiography/dr': '数字射线 DR（待开发）',
                            'radiography/ict': '工业 CT（待开发）',
                            'radiography/terahertz': '太赫兹（待开发）',
                            'optical/vt': '内窥镜 VT（待开发）',
                            'optical/irt': '红外热成像 IRT（待开发）',
                            'optical/shearography': '激光剪切散斑（待开发）',
                            'electromagnetic/et': '涡流 ET（待开发）',
                        }
                        const msg = placeholderMap[datasetPath] || '请选择子类'
                        return (
                            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: '#999', fontSize: 16 }}>
                                {msg}
                            </div>
                        )
                    })()}
                </div>
                {/* 模型测试 TestingPanel ****************/}
                <div style={{ height: '100%', overflow: 'auto', display: activeModule === 'test' ? 'block' : 'none' }}>
                    {(() => {
                        if (testPath === CSCAN_DATASET) return <CScanTestPanel active={activeModule === 'test'} />
                        if (testPath === RUNNABLE_ASCAN) return <TestingPanel active={activeModule === 'test'} />
                        const leaf = findDataset(testPath)
                        return (
                            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: '#999', fontSize: 16 }}>
                                {(leaf?.label?.split('（')[0] || testPath)} · 测试界面暂空（待接入）
                            </div>
                        )
                    })()}
                </div>
                {/* 智能评估 EvaluationPanel ****************/}
                <div style={{ height: '100%', display: activeModule === 'analysis' ? 'block' : 'none' }}>
                    <EvaluationPanel />
                </div>
                {/* CScan 标注入库（上传图片时进入） ****************/}
                <div style={{ height: '100%', overflow: 'auto', display: (activeModule === 'labeling' && imageSession) ? 'block' : 'none' }}>
                    <CScanLabeler initial={imageSession} />
                </div>
                {/* 数据标注(.nde/.csv/.zip 检视标注) ****************/}
                <div style={{ height: '100%', display: (activeModule === 'labeling' && !imageSession) ? 'block' : 'none' }}>
                    {info && (
                        <Tabs
                            activeKey={activeViewTab}
                            onChange={setActiveViewTab}
                            tabBarStyle={{ color: '#fff', background: '#fff', padding: '8px 12px', borderRadius: '8px' }}

                            items={[
                                // 数据标注 - 第一个标签页Inspect
                                {
                                    key: 'inspect',
                                    label: 'Inspect',
                                    children: (
                                        <InspectPanel
                                            info={info}
                                            editableJson={editableJson}
                                            handleJsonEdit={handleJsonEdit}
                                            saveAsJson={saveAsJson}
                                            currentPath={currentPath}
                                        />
                                    )
                                },
                                // 数据标注 - 第二个标签页Display（类型不支持时置灰不可用）
                                {
                                    key: 'display',
                                    label: 'Display',
                                    disabled: !['waveform', 'nde_tensor'].includes(info.type),
                                    children: (
                                            <Tabs
                                                defaultActiveKey="ascan"
                                                items={[
                                                    // MatrixViewer 展示原始帧矩阵数据
                                                    {
                                                        key: 'matrix',
                                                        label: 'Matrix',
                                                        children: <MatrixViewer frames={frames} />
                                                    },
                                                    // AScanViewer 绘制波形图
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
                                                                labels={frameLabels}
                                                                onLabelChange={handleSaveFrameLabel}
                                                                yAxisRange={yAxisRange}
                                                            />
                                                        )
                                                    },
                                                    // HeatmapViewer 绘制热图
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
                                                    },
                                                    // Structure3DViewer 绘制结构几何示意
                                                    {
                                                        key: '3d',
                                                        label: '3D',
                                                        children: <Structure3DViewer filename={currentFile} />
                                                    }
                                                ]}
                                            />
                                        )
                                }
                            ]}
                        />
                    )}
                </div>
            </Content>

        </Layout>
    )
}