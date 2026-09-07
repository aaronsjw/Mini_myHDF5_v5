// CScan 原图标注入库界面（并入「数据标注」模块；上传图片时进入）
// 三步：① 补全元数据(自动规范化文件名预览) ② 画框标注(画/移/缩放/删/类选/缩放平移/上下一张)
//       ③ 保存入库(raw 三件套 + 后台自动切片 images/labels/meta)
import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
    Card, Button, Upload, Select, Input, Tag, message,
    Row, Col, Space, Divider, Spin, Modal,
} from 'antd'
import {
    PlusOutlined, DeleteOutlined, UndoOutlined, SaveOutlined,
    ZoomInOutlined, ZoomOutOutlined, AimOutlined, PictureOutlined,
} from '@ant-design/icons'
import axios from 'axios'

const API = 'http://127.0.0.1:8000'
const CW = 900          // canvas 内部宽(px)
const CH = 600          // canvas 内部高(px)
const HANDLE = 8        // 选中框角点手柄半径(canvas px)
const MIN_NORM = 0.002  // 归一化最小宽高，小于则丢弃

const clean = v => (String(v ?? '').trim().replace(/[/\\\s_]+/g, '-') || 'NaN')
const pad2 = n => String(n).padStart(2, '0')
const fileStamp = d => `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
const stemFromName = name => (name || '').replace(/\.(bmp|png|jpe?g)$/i, '')
const tsFromStem = stem => (stem.match(/(\d{14})/) || [])[1] || ''

let UID = 1
const nid = () => UID++

export default function CScanLabeler({ initial = null, onExit }) {
    const [classList, setClassList] = useState([])       // [{id, code, zh}]
    const [currentClassId, setCurrentClassId] = useState(0)
    const [files, setFiles] = useState([])               // [{name, file, url, fromRaw}]
    const [idx, setIdx] = useState(0)
    const fileUrl = files[idx]?.url || ''
    const cur = files[idx] || null

    const [meta, setMeta] = useState({
        fiber: '', matrix: '', structure: '', method: '', code: '',
        fiberGrade: '', matrixGrade: '', timestamp: '', probe_type: '', description: '',
    })
    const [defectType, setDefectType] = useState('Dl')   // 整图标签(code)
    const [imgSize, setImgSize] = useState(null)

    const [boxes, setBoxes] = useState([])               // {uid,class_id,x1,y1,x2,y2} 归一化
    const [selected, setSelected] = useState(-1)
    const [mode, setMode] = useState('annotate')         // annotate | pan
    const [zoom, setZoom] = useState(1)
    const [pan, setPan] = useState({ x: 0, y: 0 })
    const [baseZoom, setBaseZoom] = useState(1)
    const [showGrid, setShowGrid] = useState(true)

    const [saving, setSaving] = useState(false)
    const [addClassOpen, setAddClassOpen] = useState(false)
    const [newCode, setNewCode] = useState('')
    const [newZh, setNewZh] = useState('')

    const canvasRef = useRef(null)
    const imgElRef = useRef(null)
    const dragRef = useRef(null)

    // 类表
    useEffect(() => {
        axios.get(`${API}/cscan/classes`).then(res => {
            if (res.data?.classes?.length) {
                setClassList(res.data.classes)
                setCurrentClassId(res.data.classes[0].id)
            }
        }).catch(() => message.error('无法获取类别表'))
    }, [])

    // 图片自然尺寸 + 复位画布
    useEffect(() => {
        if (!fileUrl) { imgElRef.current = null; setImgSize(null); return }
        const img = new Image()
        img.onload = () => {
            imgElRef.current = img
            const w = img.naturalWidth, h = img.naturalHeight
            setImgSize({ w, h })
            setBaseZoom(Math.min((CW - 24) / w, (CH - 24) / h))
            setZoom(1); setPan({ x: 0, y: 0 })
        }
        img.src = fileUrl
    }, [fileUrl])

    // App 传入的初始图
    useEffect(() => {
        if (initial && initial.file) {
            const f = initial.file
            setFiles([{ name: initial.name || f.name, file: f, url: URL.createObjectURL(f), fromRaw: false }])
            setIdx(0)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initial])

    const addLocalFiles = (entries) => {
        setFiles(prev => {
            const list = entries.map(e => ({
                name: e.name, file: e.file,
                url: e.url || URL.createObjectURL(e.file), fromRaw: false,
            }))
            const next = [...prev, ...list]
            if (prev.length === 0) setIdx(0)
            return next
        })
    }

    // 切图：重置框
    useEffect(() => { setBoxes([]); setSelected(-1) }, [fileUrl])

    // 打开已有 raw 图：载入边车 + 框 + 原图
    const openRawItem = async (name) => {
        const stem = stemFromName(name)
        if (!stem) return
        try {
            const item = (await axios.get(`${API}/cscan/raw/item?stem=${encodeURIComponent(stem)}`)).data
            if (item.error) { message.error(item.error); return }
            const blob = (await axios.get(`${API}/cscan/image?name=${encodeURIComponent(item.filename)}`, { responseType: 'blob' })).data
            const f = new File([blob], item.filename, { type: blob.type || 'image/png' })
            const url = URL.createObjectURL(f)
            const m = item.meta || {}
            setMeta({
                fiber: m.fiber || '', matrix: m.matrix || '', structure: m.structure || '',
                method: m.method || '', code: m.code || '', fiberGrade: m.fiberGrade || '',
                matrixGrade: m.matrixGrade || '', timestamp: tsFromStem(stem) || '',
                probe_type: m.probe_type || '', description: m.description || '',
            })
            setDefectType(m.defectType || (item.yolo?.length ? (classList.find(c => c.id === item.yolo[0].class_id)?.code || '') : 'OK'))
            setBoxes((item.yolo || []).map(y => ({
                uid: nid(), class_id: y.class_id,
                x1: y.cx - y.w / 2, y1: y.cy - y.h / 2, x2: y.cx + y.w / 2, y2: y.cy + y.h / 2,
            })))
            setFiles(prev => {
                const cleanPrev = prev.filter(p => p.name !== item.filename)
                const next = [...cleanPrev, { name: item.filename, file: f, url, fromRaw: true }]
                setIdx(next.length - 1)
                return next
            })
        } catch (e) { message.error('打开 raw 图失败') }
    }

    // 布局换算
    const layout = () => {
        if (!imgSize) return null
        const z = baseZoom * zoom
        const w = imgSize.w * z, h = imgSize.h * z
        return { z, w, h, ox: (CW - w) / 2 + pan.x, oy: (CH - h) / 2 + pan.y }
    }
    const toImg = (px, py) => {
        const L = layout()
        if (!L) return { x: -1, y: -1 }
        return { x: (px - L.ox) / L.w, y: (py - L.oy) / L.h }
    }
    const codeOf = (class_id) => classList.find(c => c.id === class_id)?.code || String(class_id)
    const colorOf = (class_id) => {
        const map = { Dl: '#f5222d', Db: '#fa8c16', Po: '#fadb14' }
        if (map[codeOf(class_id)]) return map[codeOf(class_id)]
        const palette = ['#13c2c2', '#722ed1', '#1890ff', '#2f54eb', '#eb2f96', '#52c41a']
        return palette[Math.abs(class_id) % palette.length]
    }

    // 绘制
    const draw = useCallback(() => {
        const c = canvasRef.current
        if (!c) return
        c.width = CW; c.height = CH
        const ctx = c.getContext('2d')
        ctx.fillStyle = '#111'; ctx.fillRect(0, 0, CW, CH)
        const img = imgElRef.current, L = layout()
        if (!img || !L) {
            ctx.fillStyle = '#666'; ctx.font = '14px sans-serif'; ctx.textAlign = 'center'
            ctx.fillText('请选择一张 C 扫图（元数据 + 画框后保存入库）', CW / 2, CH / 2)
            ctx.textAlign = 'left'; return
        }
        ctx.drawImage(img, L.ox, L.oy, L.w, L.h)
        if (showGrid) {
            ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1
            for (let g = 0; g <= 1; g += 0.1) {
                ctx.beginPath(); ctx.moveTo(L.ox + L.w * g, L.oy); ctx.lineTo(L.ox + L.w * g, L.oy + L.h); ctx.stroke()
                ctx.beginPath(); ctx.moveTo(L.ox, L.oy + L.h * g); ctx.lineTo(L.ox + L.w, L.oy + L.h * g); ctx.stroke()
            }
        }
        boxes.forEach((b, i) => {
            const x = L.ox + b.x1 * L.w, y = L.oy + b.y1 * L.h
            const w = (b.x2 - b.x1) * L.w, h = (b.y2 - b.y1) * L.h
            const col = colorOf(b.class_id), sel = i === selected
            ctx.strokeStyle = sel ? '#fff' : col
            ctx.lineWidth = sel ? 3 : 2
            ctx.strokeRect(x, y, w, h)
            ctx.fillStyle = col; ctx.font = 'bold 13px sans-serif'
            ctx.fillText(`${codeOf(b.class_id)}`, x, Math.max(y - 4, 12))
            if (sel) {
                ctx.fillStyle = '#fff'
                for (const [hx, hy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]])
                    ctx.fillRect(hx - HANDLE / 2, hy - HANDLE / 2, HANDLE, HANDLE)
            }
        })
    }, [boxes, selected, zoom, pan, baseZoom, imgSize, fileUrl, classList, mode, showGrid])
    useEffect(() => { draw() }, [draw])

    // ── 鼠标交互 ──
    const evtPos = (e) => {
        const rect = canvasRef.current.getBoundingClientRect()
        return { x: (e.clientX - rect.left) * (CW / rect.width), y: (e.clientY - rect.top) * (CH / rect.height) }
    }
    const hitTest = (px, py) => {
        const L = layout(); if (!L) return { idx: -1, handle: -1 }
        for (let i = boxes.length - 1; i >= 0; i--) {
            const b = boxes[i]
            const x = L.ox + b.x1 * L.w, y = L.oy + b.y1 * L.h
            const w = (b.x2 - b.x1) * L.w, h = (b.y2 - b.y1) * L.h
            if (i === selected) {
                for (let hi = 0; hi < 4; hi++) {
                    const cxs = [x, x + w, x, x + w][hi], cys = [y, y, y + h, y + h][hi]
                    if (Math.abs(px - cxs) <= HANDLE && Math.abs(py - cys) <= HANDLE) return { idx: i, handle: hi }
                }
            }
            if (px >= x && px <= x + w && py >= y && py <= y + h) return { idx: i, handle: -1 }
        }
        return { idx: -1, handle: -1 }
    }

    const onMouseDown = (e) => {
        const { x: px, y: py } = evtPos(e)
        const L = layout()
        if (mode === 'pan') {
            dragRef.current = { type: 'pan', sx: e.clientX, sy: e.clientY, panX: pan.x, panY: pan.y }
            return
        }
        const hit = hitTest(px, py)
        if (hit.idx >= 0) {
            const b = boxes[hit.idx]
            setSelected(hit.idx)
            if (hit.handle >= 0) {
                const c = [[b.x1, b.y1], [b.x2, b.y1], [b.x1, b.y2], [b.x2, b.y2]][hit.handle]
                dragRef.current = { type: 'resize', idx: hit.idx, handle: hit.handle, anchor: c }
            } else {
                dragRef.current = { type: 'move', idx: hit.idx, startX: b.x1, startY: b.y1, from: toImg(px, py) }
            }
        } else if (L && px >= L.ox && px <= L.ox + L.w && py >= L.oy && py <= L.oy + L.h) {
            const p = toImg(px, py)
            const newIdx = boxes.length
            setSelected(newIdx)
            dragRef.current = { type: 'new', origin: p }
            setBoxes(prev => [...prev, { uid: nid(), class_id: currentClassId, x1: p.x, y1: p.y, x2: p.x, y2: p.y }])
        }
    }
    const onMouseMove = (e) => {
        const d = dragRef.current
        if (!d) return
        if (d.type === 'pan') { setPan({ x: d.panX + (e.clientX - d.sx), y: d.panY + (e.clientY - d.sy) }); return }
        const p = toImg(evtPos(e).x, evtPos(e).y)
        if (d.type === 'new') {
            setBoxes(prev => prev.map((b, i) => i === prev.length - 1 ? {
                ...b,
                x1: Math.max(0, Math.min(1, Math.min(d.origin.x, p.x))), y1: Math.max(0, Math.min(1, Math.min(d.origin.y, p.y))),
                x2: Math.max(0, Math.min(1, Math.max(d.origin.x, p.x))), y2: Math.max(0, Math.min(1, Math.max(d.origin.y, p.y))),
            } : b))
        } else if (d.type === 'move') {
            const dx = p.x - d.from.x, dy = p.y - d.from.y
            setBoxes(prev => prev.map((b, i) => i === d.idx ? {
                ...b,
                x1: Math.max(0, Math.min(1, d.startX + dx)), y1: Math.max(0, Math.min(1, d.startY + dy)),
                x2: Math.max(0, Math.min(1, d.startX + dx + (b.x2 - b.x1))),
                y2: Math.max(0, Math.min(1, d.startY + dy + (b.y2 - b.y1))),
            } : b))
        } else if (d.type === 'resize') {
            setBoxes(prev => prev.map((b, i) => {
                if (i !== d.idx) return b
                const x1 = d.handle === 0 || d.handle === 2 ? Math.min(p.x, d.anchor[0]) : b.x1
                const y1 = d.handle === 0 || d.handle === 1 ? Math.min(p.y, d.anchor[1]) : b.y1
                const x2 = d.handle === 1 || d.handle === 3 ? Math.max(p.x, d.anchor[0]) : b.x2
                const y2 = d.handle === 2 || d.handle === 3 ? Math.max(p.y, d.anchor[1]) : b.y2
                return { ...b, x1: Math.max(0, Math.min(1, x1)), y1: Math.max(0, Math.min(1, y1)), x2: Math.max(0, Math.min(1, x2)), y2: Math.max(0, Math.min(1, y2)) }
            }))
        }
    }
    const onMouseUp = () => {
        if (dragRef.current?.type === 'new') {
            setBoxes(prev => prev.filter(b => b.x2 - b.x1 > MIN_NORM && b.y2 - b.y1 > MIN_NORM))
            setSelected(prev => Math.min(prev, Math.max(boxes.length, 0)))
        }
        dragRef.current = null
    }
    const deleteSelected = () => {
        if (selected < 0) return
        setBoxes(prev => prev.filter((_, i) => i !== selected))
        setSelected(-1)
    }
    const removeCurrent = () => {
        if (!cur) return
        const next = files.filter((_, i) => i !== idx)
        setFiles(next)
        if (next.length) setIdx(Math.min(idx, next.length - 1))
        else setIdx(0)
    }

    // 预览规范化文件名
    const previewStem = [
        clean(meta.fiber), clean(meta.matrix), clean(meta.structure), clean(meta.method),
        clean(defectType), clean(meta.code),
        /^\d{14}$/.test(meta.timestamp || '')
            ? meta.timestamp
            : fileStamp(cur?.file?.lastModified ? new Date(cur.file.lastModified) : new Date()),
        clean(meta.fiberGrade), clean(meta.matrixGrade),
    ].join('_')

    // 保存入库(自动切片)
    const save = async () => {
        if (!cur) { message.warning('没有当前图片'); return }
        if (!imgSize) return
        if (!defectType) { message.warning('请选择整图缺陷类型'); return }
        const ts = String(meta.timestamp || '')
        if (ts && !/^\d{14}$/.test(ts)) { message.warning('时间戳需为 14 位数字，或留空自动取文件时间'); return }
        setSaving(true)
        try {
            const m = {
                ...meta,
                timestamp: /^\d{14}$/.test(ts) ? ts : '',
                defectType,
                fiber: meta.fiber || 'NaN', matrix: meta.matrix || 'NaN',
                structure: meta.structure || 'NaN', method: meta.method || 'NaN',
                code: meta.code || 'NaN', fiberGrade: meta.fiberGrade || 'NaN',
                matrixGrade: meta.matrixGrade || 'NaN',
            }
            const yolo = boxes.map(b => ({
                class_id: b.class_id,
                cx: (b.x1 + b.x2) / 2, cy: (b.y1 + b.y2) / 2,
                w: b.x2 - b.x1, h: b.y2 - b.y1,
            }))
            const fd = new FormData()
            fd.append('file', cur.file)
            fd.append('meta', JSON.stringify(m))
            fd.append('boxes', JSON.stringify(yolo))
            const res = await axios.post(`${API}/cscan/raw/save`, fd)
            if (res.data.error) { message.error(res.data.error); return }
            message.success(`已入库 ${res.data.filename}（切片 ${res.data.slice.tiles}：正${res.data.slice.pos}/背景${res.data.slice.neg}）`)
            if (idx < files.length - 1 && !cur.fromRaw) setIdx(idx + 1)
        } catch (e) {
            message.error(`保存失败: ${e?.response?.data?.error || e.message || ''}`)
        } finally { setSaving(false) }
    }

    // 新增缺陷类
    const addClass = async () => {
        if (!/^[A-Za-z]{1,4}$/.test(newCode)) { message.warning('缺陷码为 1-4 位字母，如 Vo'); return }
        try {
            const res = await axios.post(`${API}/cscan/classes/add`, { code: newCode.trim(), zh: newZh.trim() })
            if (res.data.error) { message.error(res.data.error); return }
            const fresh = (await axios.get(`${API}/cscan/classes`)).data.classes || []
            setClassList(fresh); setCurrentClassId(res.data.id)
            setAddClassOpen(false); setNewCode(''); setNewZh('')
            message.success(`已新增 ${newCode} (id=${res.data.id})；旧 best.pt 需重训才可检出该类`)
        } catch (e) { message.error('新增类别失败') }
    }

    const classOptions = classList.map(c => ({ value: c.id, label: `${c.code} - ${c.zh}` }))
    const defectOptions = classList.map(c => ({ value: c.code, label: `${c.code} - ${c.zh}` }))
    const selBox = selected >= 0 ? boxes[selected] : null
    const classSelValue = selBox ? selBox.class_id : currentClassId

    return (
        <div style={{ height: '100%', overflow: 'auto', paddingRight: 4 }}>
            <Row gutter={12}>
                {/* 左：元数据 + 入库 */}
                <Col span={7}>
                    <Card size="small" title={<Space><PictureOutlined />元数据 & 入库</Space>}
                        extra={onExit ? <Button size="small" onClick={onExit}>退出图像模式</Button> : null}>
                        <Space wrap style={{ marginBottom: 8 }}>
                            <Upload accept=".bmp,.png,.jpg,.jpeg" multiple showUploadList={false}
                                beforeUpload={(_, list) => { addLocalFiles(list.map(x => ({ file: x, name: x.name }))); return false }}>
                                <Button size="small" icon={<PlusOutlined />}>打开本地图</Button>
                            </Upload>
                            <RawOpenDropdown onPick={openRawItem} />
                        </Space>
                        {cur && (
                            <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
                                第 {idx + 1}/{files.length} 张：<Tag color="blue" style={{ wordBreak: 'break-all' }}>{cur.name}</Tag>
                                <div>
                                    <Button size="small" type="link" disabled={idx <= 0} onClick={() => setIdx(idx - 1)}>上一张</Button>
                                    <Button size="small" type="link" disabled={idx >= files.length - 1} onClick={() => setIdx(idx + 1)}>下一张</Button>
                                    <Button size="small" type="link" onClick={removeCurrent}>移除当前</Button>
                                </div>
                            </div>
                        )}

                        <Space direction="vertical" style={{ width: '100%' }} size={5}>
                            <MetaField label="纤维" v={meta.fiber} onChange={v => setMeta({ ...meta, fiber: v })} opts={['CF', 'GF', 'BF', 'AF']} />
                            <MetaField label="基体" v={meta.matrix} onChange={v => setMeta({ ...meta, matrix: v })} opts={['EP', 'BMI', 'PI', 'TP', 'SiC']} />
                            <MetaField label="结构" v={meta.structure} onChange={v => setMeta({ ...meta, structure: v })} opts={['Plate', 'Taper', 'BondPP', 'BondSC']} />
                            <MetaField label="方法" v={meta.method} onChange={v => setMeta({ ...meta, method: v })} opts={['WRUT', 'WPUT', 'PAUT', 'AUT']} />
                            <div>
                                <div style={{ color: '#888', fontSize: 12, marginBottom: 2 }}>整图缺陷类型</div>
                                <Space.Compact style={{ width: '100%' }}>
                                    <Select size="small" style={{ flex: 1 }} showSearch optionFilterProp="label"
                                        value={defectType} onChange={setDefectType} options={defectOptions} />
                                    <Button size="small" onClick={() => setAddClassOpen(true)}>＋新类</Button>
                                </Space.Compact>
                            </div>
                            <MetaField label="型号 code" v={meta.code} onChange={v => setMeta({ ...meta, code: v })} />
                            <MetaField label="纤维牌号" v={meta.fiberGrade} onChange={v => setMeta({ ...meta, fiberGrade: v })} />
                            <MetaField label="基体牌号" v={meta.matrixGrade} onChange={v => setMeta({ ...meta, matrixGrade: v })} />
                            <MetaField label="时间戳(14位·留空自动)" v={meta.timestamp} onChange={v => setMeta({ ...meta, timestamp: v })} />
                            <MetaField label="探头 probe_type" v={meta.probe_type} onChange={v => setMeta({ ...meta, probe_type: v })} />
                            <Input size="small" placeholder="描述(损伤/增益/来源…)" value={meta.description}
                                onChange={e => setMeta({ ...meta, description: e.target.value })} />
                        </Space>

                        <Divider style={{ margin: '8px 0' }} />
                        <div style={{ fontSize: 12, color: '#888' }}>规范文件名预览（后端为准）</div>
                        <Tag color="geekblue" style={{ whiteSpace: 'normal', wordBreak: 'break-all', marginTop: 4 }}>{previewStem}.png</Tag>
                        <Button type="primary" block icon={<SaveOutlined />} loading={saving} onClick={save}
                            disabled={!cur || !imgSize} style={{ marginTop: 8 }}>
                            保存入库（自动切片）
                        </Button>
                        {boxes.length === 0 &&
                            <div style={{ fontSize: 12, color: '#999', marginTop: 6 }}>当前无框 → 作为背景/无缺陷整图入库（仍切为背景 tile）</div>}
                    </Card>
                </Col>

                {/* 右：标注画布 */}
                <Col span={17}>
                    <Card size="small" title="缺陷标注"
                        extra={<Tag color="blue">空白拖拽=画新框；点框选中 → 拖身移动 / 拖角缩放 / 删</Tag>}
                        bodyStyle={{ padding: 8 }}>
                        <Space wrap style={{ marginBottom: 8 }}>
                            <Select size="small" style={{ width: 170 }} value={classSelValue}
                                onChange={v => {
                                    if (selBox) setBoxes(prev => prev.map((b, i) => i === selected ? { ...b, class_id: v } : b))
                                    else setCurrentClassId(v)
                                }}
                                options={classOptions} placeholder="类别(作用于选中框或新框)" />
                            <Button size="small" type={mode === 'annotate' ? 'primary' : 'default'} onClick={() => setMode('annotate')}>标注</Button>
                            <Button size="small" type={mode === 'pan' ? 'primary' : 'default'} onClick={() => setMode('pan')}>平移</Button>
                            <Button size="small" icon={<ZoomInOutlined />} onClick={() => setZoom(z => Math.min(z * 1.25, 16))} />
                            <Button size="small" icon={<ZoomOutOutlined />} onClick={() => setZoom(z => Math.max(z / 1.25, 0.1))} />
                            <Button size="small" icon={<AimOutlined />} onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }}>适配</Button>
                            <Button size="small" onClick={() => setShowGrid(v => !v)}>{showGrid ? '隐藏网格' : '网格'}</Button>
                            <Divider type="vertical" />
                            <Tag color="purple">{selBox ? `${codeOf(selBox.class_id)} #${selected + 1}` : '未选中'}</Tag>
                            <Button size="small" danger icon={<DeleteOutlined />} onClick={deleteSelected} disabled={selected < 0}>删除选中</Button>
                            <Button size="small" icon={<UndoOutlined />} onClick={() => { setBoxes(prev => prev.slice(0, -1)); setSelected(-1) }} disabled={boxes.length === 0}>撤销最后</Button>
                        </Space>
                        <div style={{ textAlign: 'center' }}>
                            <canvas ref={canvasRef}
                                style={{ width: '100%', background: '#111', border: '1px solid #e8e8e8', borderRadius: 4, cursor: mode === 'pan' ? 'grab' : 'crosshair' }}
                                onMouseDown={onMouseDown} onMouseMove={onMouseMove}
                                onMouseUp={onMouseUp} onMouseLeave={onMouseUp} />
                        </div>
                        <div style={{ marginTop: 8 }}>
                            {boxes.map((b, i) => (
                                <Tag key={b.uid} color={colorOf(b.class_id)} style={{ cursor: 'pointer', marginBottom: 4 }}
                                    onClick={() => setSelected(i)}>
                                    #{i + 1} {codeOf(b.class_id)}
                                </Tag>
                            ))}
                            {boxes.length === 0 && <span style={{ color: '#bbb', fontSize: 12 }}>在图上拖拽画缺陷框，或直接保存为背景</span>}
                        </div>
                    </Card>
                </Col>
            </Row>

            <Modal title="新增缺陷码（写入 raw/labels.txt + codes.json）" open={addClassOpen}
                onOk={addClass} onCancel={() => setAddClassOpen(false)} okText="新增" cancelText="取消">
                <Space direction="vertical" style={{ width: '100%' }}>
                    <Input addonBefore="缺陷码" placeholder="如 Vo / In / Rs" value={newCode} onChange={e => setNewCode(e.target.value)} />
                    <Input addonBefore="中文名" placeholder="如 气孔 / 夹杂 / 富树脂" value={newZh} onChange={e => setNewZh(e.target.value)} />
                    <div style={{ color: '#999', fontSize: 12 }}>新增后旧 best.pt 无法检出该类，需在 tools 重新训练。</div>
                </Space>
            </Modal>
        </div>
    )
}

// 元数据字段：有选项用下拉(可选自定义另输入用自由选项需 allowClear + 仅已知)
function MetaField({ label, v, onChange, opts = [], placeholder }) {
    const options = opts.length
        ? [...opts, ...(v && !opts.includes(v) ? [v] : [])].map(o => ({ value: o, label: o }))
        : []
    return (
        <div>
            <div style={{ color: '#888', fontSize: 12, marginBottom: 2 }}>{label}</div>
            {opts.length
                ? <Select size="small" style={{ width: '100%' }} showSearch allowClear placeholder={placeholder}
                    value={v || undefined} options={options} onChange={onChange} optionFilterProp="label" />
                : <Input size="small" value={v} placeholder={placeholder} onChange={e => onChange(e.target.value)} />}
        </div>
    )
}

// 打开 raw 已有图（远端下拉，含当前文件名）
function RawOpenDropdown({ onPick }) {
    const [list, setList] = useState([])
    const [loading, setLoading] = useState(false)
    useEffect(() => {
        setLoading(true)
        axios.get(`${API}/cscan_dataset`).then(res => {
            if (res.data?.files) setList(res.data.files.map(f => ({ value: f.filename, label: f.filename })))
        }).catch(() => {}).finally(() => setLoading(false))
    }, [])
    const reload = () => {
        setLoading(true)
        axios.get(`${API}/cscan_dataset`).then(res => {
            if (res.data?.files) setList(res.data.files.map(f => ({ value: f.filename, label: f.filename })))
        }).catch(() => {}).finally(() => setLoading(false))
    }
    return (
        <Select size="small" placeholder="打开 raw 已有图续标" loading={loading}
            showSearch optionFilterProp="label" value={null} onChange={onPick}
            onDropdownVisibleChange={open => { if (open) reload() }}
            style={{ width: 196 }} options={list}
            notFoundContent={list.length === 0 ? <div style={{ padding: 8, color: '#999' }}>暂无 raw 图（先保存入库）</div> : null}
            popupMatchSelectWidth={false} />
    )
}
