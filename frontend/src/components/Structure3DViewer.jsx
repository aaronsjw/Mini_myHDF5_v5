import React, { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { Card } from 'antd'
import { parseNdeFilename, buildStructureDescription } from '../utils/ndeMeta'

// ── 板材盒体（BoxGeometry + 标准材质 + 边线框）──
function makeBox(w, d, th, y, color, opacity = 0.4, edgeColor = 0x3a4a5f) {
    const geo = new THREE.BoxGeometry(w, th, d)
    const mat = new THREE.MeshStandardMaterial({
        color, roughness: 0.5, metalness: 0.15, transparent: true, opacity,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.y = y
    const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({ color: edgeColor })
    )
    mesh.add(edges)
    return mesh
}

// ── 蜂窝芯：中空薄壁蜂窝格（相邻格子共享一面壁，壁只画一次）──
// 每个六边形的 6 条边生成一薄壁面板；用端点对去重，保证共享壁不重复
function makeHoneycombWall(x1, z1, x2, z2, height, yCenter, thickness, color) {
    const dx = x2 - x1
    const dz = z2 - z1
    const len = Math.sqrt(dx * dx + dz * dz)
    const geo = new THREE.BoxGeometry(len, height, thickness)
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1 })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set((x1 + x2) / 2, yCenter, (z1 + z2) / 2)
    // three.js rotation.y 后 X 轴指向 (cosθ, 0, -sinθ)，要贴合边方向 (dx,dz) 需 θ=atan2(-dz, dx)
    mesh.rotation.y = Math.atan2(-dz, dx)
    return mesh
}

// 胞元轮廓边框：六棱柱 EdgesGeometry（上下六边形环 + 6 条竖直棱线）
function makeCellOutline(cx, cz, R, height, yCenter, color) {
    const geo = new THREE.CylinderGeometry(R, R, height, 6)
    const edges = new THREE.EdgesGeometry(geo)
    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color }))
    line.position.set(cx, yCenter, cz)
    return line
}

function buildHoneycomb() {
    const R = 0.8                       // 六边形边长 = 外接圆半径
    const height = 2.0                  // 壁高（y 从 0.6 到 2.6）
    const yCenter = 1.6                 // 壁底贴下板顶面(0.6)：0.6 + height/2
    const thickness = 0.08              // 壁厚
    const group = new THREE.Group()
    const seen = new Set()

    // 坐标取整并归一化负零，保证共享壁去重键一致
    const fmt = x => {
        const n = Math.round(x * 1000) / 1000
        return (n === 0 ? 0 : n).toFixed(3)
    }
    const cellKey = (cx, cz) => `${fmt(cx)},${fmt(cz)}`

    // 画一个胞元的 6 条壁，共享壁（相邻胞元共用的边）只画一次
    const addCellWalls = (cx, cz) => {
        for (let k = 0; k < 6; k++) {
            const a = (Math.PI / 3) * k
            const x1 = cx + R * Math.cos(a)
            const z1 = cz + R * Math.sin(a)
            const x2 = cx + R * Math.cos(a + Math.PI / 3)
            const z2 = cz + R * Math.sin(a + Math.PI / 3)
            const p1 = `${fmt(x1)},${fmt(z1)}`
            const p2 = `${fmt(x2)},${fmt(z2)}`
            const key = p1 < p2 ? `${p1}|${p2}` : `${p2}|${p1}`
            if (seen.has(key)) continue
            seen.add(key)
            group.add(makeHoneycombWall(x1, z1, x2, z2, height, yCenter, thickness, 0xd9a441))
        }
    }

    // 按相邻关系 BFS 生长，铺满板面（无重叠）：
    // 从中心 0 出发，每层取相邻胞元的"外侧角"胞元（如 7 与 1、2 各共享一条壁）
    const s = Math.sqrt(3) / 2
    const offsets = [
        [1.5 * R, s * R], [1.5 * R, -s * R],
        [0, Math.sqrt(3) * R], [0, -Math.sqrt(3) * R],
        [-1.5 * R, s * R], [-1.5 * R, -s * R],
    ]
    const placed = new Set()
    const queue = [[0, 0]]
    placed.add(cellKey(0, 0))
    while (queue.length) {
        const [cx, cz] = queue.shift()
        addCellWalls(cx, cz)
        for (const [ox, oz] of offsets) {
            const nx = cx + ox
            const nz = cz + oz
            const key = cellKey(nx, nz)
            if (placed.has(key)) continue
            if (Math.abs(nx) > 4.7 || Math.abs(nz) > 3.7) continue   // 板面范围 10×8
            placed.add(key)
            queue.push([nx, nz])
        }
    }
    return group
}

// ── BondSC 板芯胶接：下板 + 蜂窝芯 + 上板 ──
function buildBondSC() {
    const g = new THREE.Group()
    g.add(makeBox(10, 8, 0.6, 0.3, 0xaaaaaa))        // 下板（半透明灰）
    g.add(buildHoneycomb())                            // 蜂窝芯
    g.add(makeBox(10, 8, 0.6, 3.3, 0xaaaaaa))        // 上板（半透明灰）
    return g
}

// ── BondPP 板板胶接：下板 + 薄胶层 + 上板 ──
// 胶层居中于两板间隙：上、下板与胶层的间距相等（各 0.2）
// 下板 0.0–0.8 / 胶层 1.0–1.15 / 上板 1.35–2.15
function buildBondPP() {
    const g = new THREE.Group()
    g.add(makeBox(10, 8, 0.8, 0.4, 0xaaaaaa))        // 下板（半透明灰）
    g.add(makeBox(10, 8, 0.15, 1.075, 0x7a4e21, 0.4, 0x7a4e21))  // 胶层（薄，琥珀色，边框同色，40%透明）
    g.add(makeBox(10, 8, 0.8, 1.75, 0xaaaaaa))       // 上板（半透明灰）
    return g
}

// ── Plate 平板 ──
function buildPlate() {
    return makeBox(10, 8, 1.0, 0.5, 0xaaaaaa)
}

// ── Taper 变厚度板：ExtrudeGeometry 三角截面楔形 ──
function buildTaper() {
    const shape = new THREE.Shape()
    shape.moveTo(-5, 0)      // 薄边 x=-5
    shape.lineTo(5, 0)       // 薄边 x=+5
    shape.lineTo(-5, 1.8)    // 厚边 x=-5
    shape.closePath()
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 8, bevelEnabled: false })
    const mat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.5, transparent: true, opacity: 0.4 })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(0, 0.9, -4)   // 居中：y 0..1.8 → +0.9，z 0..8 → -4
    return mesh
}

// ── 按结构分发；未知/兜底 → 平板 ──
function buildStructureGroup(structure) {
    switch (structure) {
        case 'BondSC': return buildBondSC()
        case 'BondPP': return buildBondPP()
        case 'Taper': return buildTaper()
        case 'Plate': return buildPlate()
        default: return buildPlate()
    }
}

export default function Structure3DViewer({ filename = '' }) {
    const containerRef = useRef(null)
    const meta = parseNdeFilename(filename)
    const structure = meta?.structure || ''

    useEffect(() => {
        const container = containerRef.current
        if (!container) return
        const w = container.offsetWidth || 600
        const h = container.offsetHeight || 360

        // ── 场景 / 相机 / 渲染器 ──
        const scene = new THREE.Scene()
        scene.background = new THREE.Color(0xdbeafe)
        const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100)
        camera.position.set(11, 8, 14)
        camera.lookAt(0, 1, 0)

        const renderer = new THREE.WebGLRenderer({ antialias: true })
        renderer.setSize(w, h)
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
        container.appendChild(renderer.domElement)

        // ── 交互：OrbitControls（拖拽旋转 / 滚轮缩放 = 3D 透视）──
        const controls = new OrbitControls(camera, renderer.domElement)
        controls.enableDamping = true
        controls.target.set(0, 1, 0)
        controls.minDistance = 3
        controls.maxDistance = 40

        // ── 灯光 ──
        scene.add(new THREE.AmbientLight(0xffffff, 0.6))
        const dir1 = new THREE.DirectionalLight(0xffffff, 0.8)
        dir1.position.set(6, 12, 8)
        scene.add(dir1)
        const dir2 = new THREE.DirectionalLight(0xffffff, 0.25)
        dir2.position.set(-6, -4, -6)
        scene.add(dir2)

        // ── 坐标轴辅助 ──
        scene.add(new THREE.AxesHelper(6))

        // ── 结构几何 ──
        scene.add(buildStructureGroup(structure))

        // ── 自适应尺寸 ──
        const ro = new ResizeObserver(() => {
            const w2 = container.offsetWidth
            const h2 = container.offsetHeight
            if (!w2 || !h2) return
            camera.aspect = w2 / h2
            camera.updateProjectionMatrix()
            renderer.setSize(w2, h2)
        })
        ro.observe(container)

        // ── 渲染循环 ──
        let raf = 0
        const animate = () => {
            raf = requestAnimationFrame(animate)
            controls.update()
            renderer.render(scene, camera)
        }
        animate()

        // ── 卸载清理（防 WebGL 上下文泄漏）──
        return () => {
            cancelAnimationFrame(raf)
            ro.disconnect()
            controls.dispose()
            scene.traverse(o => {
                if (o.geometry) o.geometry.dispose()
                if (o.material) {
                    if (Array.isArray(o.material)) o.material.forEach(m => m.dispose())
                    else o.material.dispose()
                }
            })
            renderer.dispose()
            renderer.domElement.remove()
        }
    }, [structure])

    return (
        <Card title="结构几何示意" style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', gap: 12, marginTop: 8, alignItems: 'stretch' }}>
                {/* 左：3D 视窗 */}
                <div
                    ref={containerRef}
                    style={{
                        flex: '1 1 70%', height: 500,
                        borderRadius: 8, overflow: 'hidden', background: '#dbeafe',
                    }}
                />
                {/* 右：元数据描述 */}
                <div
                    style={{
                        flex: '1 1 30%', color: '#666', fontSize: 13,
                        lineHeight: 1.8, whiteSpace: 'pre-wrap', overflowY: 'auto',
                    }}
                >
                    {buildStructureDescription(meta)}
                </div>
            </div>
        </Card>
    )
}
