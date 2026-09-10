// CScan 原图标注入库界面（并入「数据标注」模块；上传图片时进入）
// 三步：① 补全元数据(自动规范化文件名预览) ② 画框标注(画/移/缩放/删/类选/缩放平移/上下一张)
//       ③ 保存入库(raw 三件套 + 后台自动切片 images/labels/meta)
import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
    Card, Button, Select, Input, InputNumber, Tag, message, Collapse,
    Space, Divider, Modal,
} from 'antd'
import {
    DeleteOutlined, UndoOutlined, SaveOutlined,
    ZoomInOutlined, ZoomOutOutlined, AimOutlined, PictureOutlined, ThunderboltOutlined,
    CheckOutlined, CloseOutlined,
} from '@ant-design/icons'
import axios from 'axios'

const API = 'http://127.0.0.1:8000'
const CW = 900          // canvas 内部宽(px)
const CH = 600          // canvas 内部高(px)
const HANDLE = 8        // 选中框角点手柄半径(canvas px)
const MIN_NORM = 0.002  // 归一化最小宽高，小于则丢弃
const RULER_COLOR = '#ff2bd6'  // 标尺醒目色：亮品红（与 C 扫图配色/缺陷框色区分度高）

const clean = v => (String(v ?? '').trim().replace(/[/\\\s_]+/g, '-') || 'NaN')
const pad2 = n => String(n).padStart(2, '0')
const clamp01 = v => Math.max(0, Math.min(1, v))

// 入库前确认框展示的元数据清单（按 详细字段 顺序）
const REQ_FIELDS = [
    { k: 'fiber', label: '纤维' }, { k: 'matrix', label: '基体' },
    { k: 'structure', label: '结构' }, { k: 'method', label: '方法' },
    { k: 'code', label: '项目' }, { k: 'fiberGrade', label: '纤维牌号' },
    { k: 'matrixGrade', label: '基体牌号' }, { k: 'probe_type', label: '探头' },
]
const fileStamp = d => `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`

let UID = 1
const nid = () => UID++

export default function CScanLabeler({ initial = null }) {
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
    const [parseText, setParseText] = useState('')        // 智能解析输入文字
    const [parsing, setParsing] = useState(false)
    const [imgSize, setImgSize] = useState(null)
    // 标尺比例尺：画一条已知 mm 的线段 → mm/px；随保存写入 meta.mm_per_px
    const [calib, setCalib] = useState(null)                 // {x1,y1,x2,y2,lenPx,mm,mmPerPx}（归一化端点）
    const [draft, setDraft] = useState(null)                 // 画线进行中的预览 {x1,y1,x2,y2}
    const [rulerSeg, setRulerSeg] = useState(null)           // 待填 mm 的线段 {x1,y1,x2,y2,lenPx}
    const [rulerMm, setRulerMm] = useState(null)             // 弹窗里用户输入的 mm
    const [rulerOpen, setRulerOpen] = useState(false)

    const [boxes, setBoxes] = useState([])               // {uid,class_id,x1,y1,x2,y2} 归一化
    const [selected, setSelected] = useState(-1)
    const [mode, setMode] = useState('annotate')         // annotate | pan
    const [zoom, setZoom] = useState(1)
    const [pan, setPan] = useState({ x: 0, y: 0 })
    const [baseZoom, setBaseZoom] = useState(1)

    const [saving, setSaving] = useState(false)
    const [confirmOpen, setConfirmOpen] = useState(false)
    const [addClassOpen, setAddClassOpen] = useState(false)
    const [newCode, setNewCode] = useState('')
    const [newZh, setNewZh] = useState('')

    const canvasRef = useRef(null)
    const imgElRef = useRef(null)
    const dragRef = useRef(null)
    const rulerRef = useRef(null)   // 画线中的实时端点（绕开 state 异步）
    const zoomRef = useRef(1), panRef = useRef({ x: 0, y: 0 })
    const baseRef = useRef(1), sizeRef = useRef(null)

    // 同步最新视图参数到 ref（供滚轮监听使用）
    useEffect(() => {
        zoomRef.current = zoom; panRef.current = pan
        baseRef.current = baseZoom; sizeRef.current = imgSize
    })

    // 滚轮：以光标为中心缩放（passive:false 才能 preventDefault 页面滚动）
    useEffect(() => {
        const cv = canvasRef.current
        if (!cv) return
        const onWheel = (e) => {
            e.preventDefault()
            const rect = cv.getBoundingClientRect()
            const px = (e.clientX - rect.left) * (CW / rect.width)
            const py = (e.clientY - rect.top) * (CH / rect.height)
            const size = sizeRef.current
            if (!size) return
            const base = baseRef.current, z = zoomRef.current, pa = panRef.current
            const Lw = size.w * base * z, Lh = size.h * base * z
            const ox = (CW - Lw) / 2 + pa.x, oy = (CH - Lh) / 2 + pa.y
            const k = e.deltaY < 0 ? 1.15 : 1 / 1.15
            const nz = Math.max(0.1, Math.min(16, z * k))
            const over = px >= ox && px <= ox + Lw && py >= oy && py <= oy + Lh
            const nx = over ? (px - ox) / Lw : 0.5
            const ny = over ? (py - oy) / Lh : 0.5
            const nLw = size.w * base * nz, nLh = size.h * base * nz
            setZoom(nz)
            setPan({
                x: (px - nx * nLw) - (CW - nLw) / 2,
                y: (py - ny * nLh) - (CH - nLh) / 2,
            })
        }
        cv.addEventListener('wheel', onWheel, { passive: false })
        return () => cv.removeEventListener('wheel', onWheel)
    }, [])

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

    // 切图：重置框与标尺
    useEffect(() => {
        setBoxes([]); setSelected(-1)
        setCalib(null); setDraft(null); setRulerOpen(false); setRulerSeg(null); setRulerMm(null)
    }, [fileUrl])

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
        // 浅色棋盘格底（白/浅灰交错，透明底观感，像图像编辑工具）
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, CW, CH)
        const CELL = 18
        ctx.fillStyle = '#e3e3e3'
        for (let row = 0; row * CELL < CH; row++)
            for (let col = 0; col * CELL < CW; col++)
                if ((row + col) % 2 === 1) ctx.fillRect(col * CELL, row * CELL, CELL, CELL)
        const img = imgElRef.current, L = layout()
        if (!img || !L) {
            ctx.fillStyle = '#8c8c8c'; ctx.font = '14px sans-serif'; ctx.textAlign = 'center'
            ctx.fillText('请选择一张 C 扫图（元数据 + 画框后保存入库）', CW / 2, CH / 2)
            ctx.textAlign = 'left'; return
        }
        ctx.drawImage(img, L.ox, L.oy, L.w, L.h)
        // 图四周一圈淡淡的深描边，把图与棋盘格背景区分开
        ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.lineWidth = 1
        ctx.strokeRect(L.ox - 0.5, L.oy - 0.5, L.w + 1, L.h + 1)
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
        // 标尺：草稿(亮橙虚线) + 已标定(品红粗实线，醒目；文字带深色底片便于阅读)
        const drawSeg = (s, color, { dash = false, width = 2 } = {}) => {
            const ax = L.ox + s.x1 * L.w, ay = L.oy + s.y1 * L.h
            const bx = L.ox + s.x2 * L.w, by = L.oy + s.y2 * L.h
            ctx.strokeStyle = color; ctx.lineWidth = width
            ctx.setLineDash(dash ? [8, 5] : [])
            ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke()
            ctx.setLineDash([])
            ctx.fillStyle = color
            const r = dash ? 3 : 5
            for (const [hx, hy] of [[ax, ay], [bx, by]]) {
                ctx.beginPath(); ctx.arc(hx, hy, r, 0, Math.PI * 2); ctx.fill()
            }
            return { ax, ay, bx, by }
        }
        if (draft) drawSeg(draft, '#ffb020', { dash: true, width: 2 })
        if (calib) {
            const { ax, ay, bx, by } = drawSeg(calib, RULER_COLOR, { width: 3.5 })
            const label = `${calib.mm}mm`   // 只显示长度，不显示 mm/px
            ctx.font = 'bold 12px sans-serif'
            const pw = ctx.measureText(label).width + 16, ph = 20
            // 标签固定在标尺包围盒右下侧；空间不足也不回退（溢出部分被画布裁剪）
            const rx = Math.max(ax, bx), byb = Math.max(ay, by)
            const lx = rx + 10, ly = byb + 10
            ctx.beginPath()
            ctx.moveTo(lx, ly + 6)
            ctx.arcTo(lx, ly, lx + 6, ly, 4); ctx.lineTo(lx + pw - 6, ly)
            ctx.arcTo(lx + pw, ly, lx + pw, ly + 6, 4); ctx.lineTo(lx + pw, ly + ph - 6)
            ctx.arcTo(lx + pw, ly + ph, lx + pw - 6, ly + ph, 4); ctx.lineTo(lx + 6, ly + ph)
            ctx.arcTo(lx, ly + ph, lx, ly + ph - 6, 4); ctx.closePath()
            ctx.fillStyle = 'rgba(15,15,22,0.74)'; ctx.fill()
            ctx.strokeStyle = RULER_COLOR; ctx.lineWidth = 1.4; ctx.stroke()
            ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
            ctx.fillText(label, lx + 8, ly + ph / 2 + 0.5)
            ctx.textBaseline = 'alphabetic'
        }
    }, [boxes, selected, zoom, pan, baseZoom, imgSize, fileUrl, classList, mode, draft, calib])
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
        if (mode === 'ruler') {
            if (!L || !imgSize || !(px >= L.ox && px <= L.ox + L.w && py >= L.oy && py <= L.oy + L.h)) return
            const p = toImg(px, py)
            const seg = { x1: p.x, y1: p.y, x2: p.x, y2: p.y }
            setDraft(seg); rulerRef.current = seg; dragRef.current = { type: 'ruler' }
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
        if (d.type === 'ruler') {
            const s0 = rulerRef.current
            let x2 = p.x, y2 = p.y
            // Shift 按住：方向吸附到 0°/45°/90°/…（长度不变，像素空间算角）
            if (e.shiftKey && imgSize) {
                const dx = (p.x - s0.x1) * imgSize.w
                const dy = (p.y - s0.y1) * imgSize.h
                const len = Math.hypot(dx, dy)
                if (len > 1e-6) {
                    const rad = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4)
                    x2 = s0.x1 + (Math.cos(rad) * len) / imgSize.w
                    y2 = s0.y1 + (Math.sin(rad) * len) / imgSize.h
                }
            }
            rulerRef.current = { ...s0, x2, y2 }
            setDraft({ ...rulerRef.current })
            return
        }
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
        const d = dragRef.current
        if (d?.type === 'new') {
            setBoxes(prev => prev.filter(b => b.x2 - b.x1 > MIN_NORM && b.y2 - b.y1 > MIN_NORM))
            setSelected(prev => Math.min(prev, Math.max(boxes.length, 0)))
        } else if (d?.type === 'ruler') {
            const s = rulerRef.current
            if (s && imgSize) {
                const seg = { x1: clamp01(s.x1), y1: clamp01(s.y1), x2: clamp01(s.x2), y2: clamp01(s.y2) }
                const lenPx = Math.hypot((seg.x2 - seg.x1) * imgSize.w, (seg.y2 - seg.y1) * imgSize.h)
                if (lenPx >= 10) {
                    setRulerSeg({ ...seg, lenPx: Math.round(lenPx * 10) / 10 })
                    setRulerMm(null); setRulerOpen(true)
                } else {
                    message.warning('线段太短，请重画（至少约 10 像素）')
                }
            }
            setDraft(null); rulerRef.current = null
        }
        dragRef.current = null
    }
    const deleteSelected = () => {
        if (selected < 0) return
        setBoxes(prev => prev.filter((_, i) => i !== selected))
        setSelected(-1)
    }
    // 无框 → 整图为好区/背景(OK)，不再沿用默认缺陷类型
    const effectiveDefect = boxes.length ? defectType : 'OK'
    // 预览规范化文件名
    const previewStem = [
        clean(meta.fiber), clean(meta.matrix), clean(meta.structure), clean(meta.method),
        clean(effectiveDefect), clean(meta.code),
        /^\d{14}$/.test(meta.timestamp || '')
            ? meta.timestamp
            : fileStamp(cur?.file?.lastModified ? new Date(cur.file.lastModified) : new Date()),
        clean(meta.fiberGrade), clean(meta.matrixGrade),
    ].join('_')

    // 保存入库(自动切片)：确认弹窗里点「确定入库」才真正调用
    const doSave = async () => {
        if (!cur) { message.warning('没有当前图片'); return }
        if (!imgSize) return
        if (!effectiveDefect) { message.warning('请选择整图缺陷类型'); return }
        const ts = String(meta.timestamp || '')
        if (ts && !/^\d{14}$/.test(ts)) { message.warning('时间戳需为 14 位数字，或留空自动取文件时间'); return }
        setSaving(true)
        try {
            const m = {
                ...meta,
                timestamp: /^\d{14}$/.test(ts) ? ts : '',
                defectType: effectiveDefect,
                fiber: meta.fiber || 'NaN', matrix: meta.matrix || 'NaN',
                structure: meta.structure || 'NaN', method: meta.method || 'NaN',
                code: meta.code || 'NaN', fiberGrade: meta.fiberGrade || 'NaN',
                matrixGrade: meta.matrixGrade || 'NaN',
            }
            // 标尺 mm/px：若已标定则写入（analyze 据此自动换算 mm）
            if (calib) m.mm_per_px = Number(calib.mmPerPx.toFixed(6))
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
        } catch (e) {
            message.error(`保存失败: ${e?.response?.data?.error || e.message || ''}`)
        } finally { setSaving(false) }
    }

    // 点「保存入库」：先校验并弹确认框（标注信息 + 元数据填写情况）
    const openConfirm = () => {
        if (!cur) { message.warning('没有当前图片'); return }
        if (!imgSize) return
        if (!effectiveDefect) { message.warning('请选择整图缺陷类型'); return }
        const ts = String(meta.timestamp || '')
        if (ts && !/^\d{14}$/.test(ts)) { message.warning('时间戳需为 14 位数字，或留空自动取文件时间'); return }
        setConfirmOpen(true)
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
    const defectOptions = [
        ...classList.map(c => ({ value: c.code, label: `${c.code} - ${c.zh}` })),
        ...(classList.some(c => c.code === 'OK') ? [] : [{ value: 'OK', label: 'OK - 好区/背景' }]),
    ]

    // 智能解析一段文字 → 自动填充元数据
    const parseMeta = async () => {
        const text = (parseText || '').trim()
        if (!text) { message.warning('请先粘贴/输入一段文字'); return }
        setParsing(true)
        try {
            const r = await axios.post(`${API}/cscan/meta/parse`, { text })
            if (r.data?.error) { message.error(r.data.error); return }
            const m = r.data.meta || {}
            setMeta(prev => ({
                ...prev,
                fiber: m.fiber || prev.fiber,
                matrix: m.matrix || prev.matrix,
                structure: m.structure || prev.structure,
                method: m.method || prev.method,
                code: m.code || prev.code,
                fiberGrade: m.fiberGrade || prev.fiberGrade,
                matrixGrade: m.matrixGrade || prev.matrixGrade,
                timestamp: m.timestamp || prev.timestamp,
                probe_type: m.probe_type || prev.probe_type,
                description: prev.description || text,
            }))
            if (m.defectType) setDefectType(m.defectType)
        } catch (e) {
            message.error('解析失败')
        } finally {
            setParsing(false)
        }
    }

    // ── 标尺比例尺 ──
    const applyCalib = () => {
        const seg = rulerSeg
        const mm = Number(rulerMm)
        if (!seg || !(mm > 0)) { message.warning('请输入该线段对应的毫米数'); return }
        const mmPerPx = mm / seg.lenPx
        setCalib({ ...seg, mm, mmPerPx })
        setRulerOpen(false); setRulerSeg(null); setMode('annotate')
    }
    const cancelCalib = () => { setRulerOpen(false); setRulerSeg(null); setMode('annotate') }
    const toggleRuler = () => {
        if (mode === 'ruler') { setMode('annotate'); return }
        setSelected(-1); setMode('ruler')
    }

    const metaKeys = ['fiber', 'matrix', 'structure', 'method', 'code', 'fiberGrade', 'matrixGrade', 'probe_type']
    const filledMetaN = metaKeys.filter(k => (meta[k] || '').trim()).length
    const selBox = selected >= 0 ? boxes[selected] : null
    const classSelValue = selBox ? selBox.class_id : currentClassId
    // 确认框：各类别计数 / 缺填统计 / 整图缺陷中文
    const tallyCounts = {}
    boxes.forEach(b => { const c = codeOf(b.class_id); tallyCounts[c] = (tallyCounts[c] || 0) + 1 })
    const missingN = REQ_FIELDS.filter(f => !(meta[f.k] || '').trim()).length
    const dtCls = classList.find(c => c.code === effectiveDefect)
    const dtZh = dtCls?.zh || (effectiveDefect === 'OK' ? '好区 / 背景' : '')
    const dtColor = dtCls ? colorOf(dtCls.id) : (effectiveDefect === 'OK' ? '#52c41a' : '#999')

    return (
        <div style={{ height: '100%', overflow: 'auto', paddingRight: 4 }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                {/* 右：元数据 + 入库（固定宽放右；画布左移靠 order:1） */}
                <div style={{ width: 460, flexShrink: 0, order: 2 }}>
                    <Card size="small" title={<Space><PictureOutlined />元数据 & 入库</Space>}>
                        {/* 智能解析：一段文字 → 自动填充 */}
                        <div style={{ marginBottom: 8 }}>
                            <Input.TextArea rows={9} value={parseText}
                                onChange={e => setParseText(e.target.value)}
                                placeholder={'粘贴文件名/描述文字(格式不限)，自动提取关键词：\n例：CF_BMI_BondSC_WRUT_Db_SYJ_20200826103050_T700_QY9511\n例：超声C扫_反射_板芯脱粘_5件蜂窝，5MHz水浸，项目SYJ…'}
                                style={{ fontSize: 12 }} />
                            <Button size="small" type="primary" ghost loading={parsing} icon={<ThunderboltOutlined />}
                                onClick={parseMeta} style={{ marginTop: 4 }}>
                                智能解析并填充
                            </Button>
                        </div>

                        <Divider style={{ margin: '4px 0 8px' }} />
                        <div style={{ fontSize: 12, color: '#888' }}>规范文件名预览</div>
                        <Tag color="geekblue" style={{ whiteSpace: 'normal', wordBreak: 'break-all', marginTop: 4 }}>{previewStem}.png</Tag>
                        <Divider style={{ margin: '4px 0 8px' }} />
                        <Collapse ghost size="small"
                            items={[{
                                key: 'detail',
                                label: <span style={{ fontSize: 13 }}>详细字段（可微调 · 已填 {filledMetaN}/{metaKeys.length}）</span>,
                                children: (
                                    <Space direction="vertical" style={{ width: '100%' }} size={5}>
                                        {/* 行1 缺陷类型 */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                                            <div style={META_LABEL}>缺陷类型</div>
                                            <Space.Compact style={{ flex: 1, minWidth: 0, width: '100%' }}>
                                                <Select size="small" style={{ flex: 1, width: '50%' }} showSearch optionFilterProp="label"
                                                    value={defectType} onChange={setDefectType} options={defectOptions} />
                                                <Button size="small" style={{ flex: 1, width: '50%' }} onClick={() => setAddClassOpen(true)}>＋新类</Button>
                                            </Space.Compact>
                                        </div>
                                        {/* 行2 纤维 + 基体 */}
                                        <div style={{ display: 'flex', gap: 8, width: '100%' }}>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <MetaField label="纤维" labelWidth={64} v={meta.fiber} onChange={v => setMeta({ ...meta, fiber: v })} opts={['CF', 'GF', 'BF', 'AF']} />
                                            </div>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <MetaField label="基体" labelWidth={64} v={meta.matrix} onChange={v => setMeta({ ...meta, matrix: v })} opts={['EP', 'BMI', 'PI', 'TP', 'SiC']} />
                                            </div>
                                        </div>
                                        {/* 行3 纤维牌号 + 基体牌号 */}
                                        <div style={{ display: 'flex', gap: 8, width: '100%' }}>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <MetaField label="纤维牌号" labelWidth={64} placeholder="如 T700" v={meta.fiberGrade} onChange={v => setMeta({ ...meta, fiberGrade: v })} />
                                            </div>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <MetaField label="基体牌号" labelWidth={64} placeholder="如 QY9511" v={meta.matrixGrade} onChange={v => setMeta({ ...meta, matrixGrade: v })} />
                                            </div>
                                        </div>
                                        {/* 行4 结构 + 方法 */}
                                        <div style={{ display: 'flex', gap: 8, width: '100%' }}>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <MetaField label="结构" labelWidth={64} v={meta.structure} onChange={v => setMeta({ ...meta, structure: v })} opts={['Plate', 'Taper', 'BondPP', 'BondSC']} />
                                            </div>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <MetaField label="方法" labelWidth={64} v={meta.method} onChange={v => setMeta({ ...meta, method: v })} opts={['WRUT', 'WPUT', 'PAUT', 'AUT']} />
                                            </div>
                                        </div>
                                        {/* 行5 项目 + 探头 */}
                                        <div style={{ display: 'flex', gap: 8, width: '100%' }}>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <MetaField label="项目" labelWidth={64} placeholder="如 SYJ" v={meta.code} onChange={v => setMeta({ ...meta, code: v })} />
                                            </div>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <MetaField label="探头" labelWidth={64} placeholder="如 5MHz water immersion" v={meta.probe_type} onChange={v => setMeta({ ...meta, probe_type: v })} />
                                            </div>
                                        </div>
                                        {/* 描述 */}
                                        <Input size="small" placeholder="描述(损伤/增益/来源…)" value={meta.description}
                                            onChange={e => setMeta({ ...meta, description: e.target.value })} />
                                    </Space>
                                ),
                            }]} />
                        <Button type="primary" block icon={<SaveOutlined />} loading={saving} onClick={openConfirm}
                            disabled={!cur || !imgSize} style={{ marginTop: 8 }}>
                            保存入库（自动切片）
                        </Button>
                        {boxes.length === 0 &&
                            <div style={{ fontSize: 12, color: '#999', marginTop: 6 }}>当前无框 → 作为背景/无缺陷整图入库（仍切为背景 tile）</div>}
                    </Card>
                </div>

                {/* 左：缺陷标注 画布（order:1 排最左，占主要宽度） */}
                <div style={{ flex: 1, minWidth: 0, order: 1 }}>
                    <Card size="small" title="缺陷标注"
                        extra={<Tag color="blue">空白拖拽=画新框；点框选中→拖/缩放/删；标尺=拖线段定 mm/px</Tag>}
                        bodyStyle={{ padding: 8 }}>
                        <Space wrap style={{ marginBottom: 8 }}>
                            <Select size="small" style={{ width: 170 }} value={classSelValue}
                                onChange={v => {
                                    if (selBox) setBoxes(prev => prev.map((b, i) => i === selected ? { ...b, class_id: v } : b))
                                    else setCurrentClassId(v)
                                }}
                                options={classOptions} placeholder="类别(作用于选中框或新框)" />
                            <Button size="small" type={mode === 'annotate' ? 'primary' : 'default'} onClick={() => setMode('annotate')}>标注</Button>
                            <Button size="small" type={mode === 'pan' ? 'primary' : 'default'} icon={<PanIcon />}
                                title="平移：按住拖动画布" onClick={() => setMode('pan')} />
                            <Button size="small" icon={<ZoomInOutlined />} onClick={() => setZoom(z => Math.min(z * 1.25, 16))} />
                            <Button size="small" icon={<ZoomOutOutlined />} onClick={() => setZoom(z => Math.max(z / 1.25, 0.1))} />
                            <Button size="small" icon={<AimOutlined />} title="适配：复位缩放/平移" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }} />
                            <Button size="small" type={mode === 'ruler' ? 'primary' : 'default'} icon={<RulerIcon />}
                                title="标尺：画一条已知长度的线段，定 mm/px 比例尺"
                                onClick={toggleRuler} />
                            <Divider type="vertical" />
                            <Tag color="purple">{selBox ? `${codeOf(selBox.class_id)} #${selected + 1}` : '未选中'}</Tag>
                            <Button size="small" danger icon={<DeleteOutlined />} onClick={deleteSelected} disabled={selected < 0}>删除选中</Button>
                            <Button size="small" icon={<UndoOutlined />} onClick={() => { setBoxes(prev => prev.slice(0, -1)); setSelected(-1) }} disabled={boxes.length === 0}>撤销最后</Button>
                        </Space>
                        <div style={{ textAlign: 'center' }}>
                            <canvas ref={canvasRef}
                                style={{ width: '100%', background: '#f0f0f0', border: '1px solid #d9d9d9', borderRadius: 4, cursor: mode === 'pan' ? 'grab' : 'crosshair' }}
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
                </div>
            </div>

            <Modal title="新增缺陷码（写入 raw/labels.txt + codes.json）" open={addClassOpen}
                onOk={addClass} onCancel={() => setAddClassOpen(false)} okText="新增" cancelText="取消">
                <Space direction="vertical" style={{ width: '100%' }}>
                    <Input addonBefore="缺陷码" placeholder="如 Vo / In / Rs" value={newCode} onChange={e => setNewCode(e.target.value)} />
                    <Input addonBefore="中文名" placeholder="如 气孔 / 夹杂 / 富树脂" value={newZh} onChange={e => setNewZh(e.target.value)} />
                    <div style={{ color: '#999', fontSize: 12 }}>新增后旧 best.pt 无法检出该类，需在 tools 重新训练。</div>
                </Space>
            </Modal>

            <Modal title="标尺标定" open={rulerOpen} onOk={applyCalib} onCancel={cancelCalib}
                okText="确定" cancelText="取消" maskClosable={false} width={380}>
                <Space direction="vertical" style={{ width: '100%' }}>
                    <div style={{ color: '#666', fontSize: 13 }}>
                        该线段在图上有 <b>{rulerSeg?.lenPx ?? '-'} px</b>，在实际零件上对应多少 mm？
                    </div>
                    <InputNumber style={{ width: '100%' }} min={0.01} precision={3}
                        placeholder="输入 mm，如 20" addonAfter="mm"
                        value={rulerMm} onChange={v => setRulerMm(v)} />
                </Space>
            </Modal>

            <Modal title="确认入库？" open={confirmOpen} width={520}
                onOk={() => { setConfirmOpen(false); doSave() }}
                onCancel={() => setConfirmOpen(false)}
                okText="确定入库" cancelText="再检查" okButtonProps={{ loading: saving }}>
                <Space direction="vertical" style={{ width: '100%' }} size={4}>
                    <div style={{ fontWeight: 600, marginBottom: 2 }}>标注信息</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 13 }}>
                        整图类别：
                        <Tag color={dtColor} style={{ marginRight: 0 }}>
                            {effectiveDefect}{dtZh ? ` · ${dtZh}` : ''}
                        </Tag>
                    </div>
                    <div style={{ fontSize: 13 }}>
                        {boxes.length === 0
                            ? <span style={{ color: '#52c41a' }}>未画缺陷框 → 按「好区 / 背景（OK）」整图入库</span>
                            : <>
                                <span>画框 {boxes.length} 个：</span>
                                {Object.entries(tallyCounts).map(([c, n]) => (
                                    <Tag key={c} color={colorOf(classList.find(x => x.code === c)?.id)} style={{ marginRight: 0 }}>{c} × {n}</Tag>
                                ))}
                              </>}
                    </div>
                    <Divider style={{ margin: '4px 0' }} />
                    <div style={{ fontWeight: 600 }}>
                        元数据填写情况
                        {missingN > 0 && <span style={{ color: '#ff4d4f', fontWeight: 400 }}>（缺 {missingN} 项）</span>}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 18, rowGap: 3 }}>
                        {REQ_FIELDS.map(f => {
                            const v = (meta[f.k] || '').trim()
                            return (
                                <div key={f.k} style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                                    <span style={{ flexShrink: 0, width: 60, textAlign: 'right', color: '#888', fontSize: 12 }}>{f.label}</span>
                                    {v
                                        ? <CheckOutlined style={{ color: '#52c41a', flexShrink: 0 }} />
                                        : <CloseOutlined style={{ color: '#ff4d4f', flexShrink: 0 }} />}
                                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: v ? '#333' : '#ff4d4f' }}
                                        title={v}>{v || '未填写'}</span>
                                </div>
                            )
                        })}
                        {/* 比例尺：与元数据同样式（可选，未标定仅提示不影响入库） */}
                        <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                            <span style={{ flexShrink: 0, width: 60, textAlign: 'right', color: '#888', fontSize: 12 }}>比例尺</span>
                            {calib
                                ? <CheckOutlined style={{ color: '#52c41a', flexShrink: 0 }} />
                                : <CloseOutlined style={{ color: '#ff4d4f', flexShrink: 0 }} />}
                            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: calib ? '#333' : '#ff4d4f' }}
                                title={calib ? `≈${calib.mmPerPx.toFixed(4)} mm/px` : ''}>
                                {calib
                                    ? `≈${calib.mmPerPx.toFixed(4)} mm/px（${calib.mm}mm / ${calib.lenPx}px）`
                                    : '未标定'}
                            </span>
                        </div>
                    </div>
                    <div style={{ color: '#aaa', fontSize: 12 }}>
                        {meta.timestamp ? `时间戳：${meta.timestamp}` : '时间戳未填 → 自动取文件修改时间'}
                    </div>
                </Space>
            </Modal>
        </div>
    )
}

// 元数据字段：有选项用下拉(可选自定义另输入用自由选项需 allowClear + 仅已知)
const META_LABEL = {
    color: '#888', fontSize: 12, width: 64, flexShrink: 0,
    whiteSpace: 'nowrap', textAlign: 'right',
}

function MetaField({ label, v, onChange, opts = [], placeholder, labelWidth = 64 }) {
    const options = opts.length
        ? [...opts, ...(v && !opts.includes(v) ? [v] : [])].map(o => ({ value: o, label: o }))
        : []
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
            <div style={{ ...META_LABEL, width: labelWidth }}>{label}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
                {opts.length
                    ? <Select size="small" style={{ width: '100%' }} showSearch allowClear placeholder={placeholder}
                        value={v || undefined} options={options} onChange={onChange} optionFilterProp="label" />
                    : <Input size="small" style={{ width: '100%' }} value={v} placeholder={placeholder}
                        onChange={e => onChange(e.target.value)} />}
            </div>
        </div>
    )
}

// 直尺图标（Lucide "ruler"，ISC License，斜 45° 刻度尺，随按钮颜色 currentColor）
function RulerIcon({ style }) {
    return (
        <svg viewBox="0 0 24 24" width="1em" height="1em"
            style={{ verticalAlign: '-0.125em', ...style }}
            fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z" />
            <path d="m14.5 12.5 2-2" />
            <path d="m11.5 9.5 2-2" />
            <path d="m8.5 6.5 2-2" />
            <path d="m17.5 15.5 2-2" />
        </svg>
    )
}

// 手掌图标（Lucide "grab"，ISC License，平放抓取手掌，用于平移/拖动）
function PanIcon({ style }) {
    return (
        <svg viewBox="0 0 24 24" width="1em" height="1em"
            style={{ verticalAlign: '-0.125em', ...style }}
            fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 11.5V9a2 2 0 0 0-2-2a2 2 0 0 0-2 2v1.4" />
            <path d="M14 10V8a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2" />
            <path d="M10 9.9V9a2 2 0 0 0-2-2a2 2 0 0 0-2 2v5" />
            <path d="M6 14a2 2 0 0 0-2-2a2 2 0 0 0-2 2" />
            <path d="M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-4a8 8 0 0 1-8-8 2 2 0 1 1 4 0" />
        </svg>
    )
}
