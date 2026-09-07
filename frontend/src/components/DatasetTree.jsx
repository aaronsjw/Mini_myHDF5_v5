// 左侧树状数据集导航（模型训练 / 模型测试用）
// 样式与「数据库」折叠面板一致；交互为可折叠手风琴：
//   · 点分组头 / 左侧箭头 展开/折叠该组（各组独立，可同时展开多个）
//   · 选中某叶子时自动展开其所在组
//   · 分组头：padding 6px 16px / bold 13px / 当前所在组蓝色 #1890ff 否则 #ccc
//   · 叶子：paddingLeft 24，叶子 padding 6px 12px，未选白 #fff / 选中 #1890ff + 淡蓝底 rgba(24,144,255,0.15)
// 叶子 value 同 datasets.js（ultrasonic/ascan 等）。
import React, { useState, useEffect } from 'react'
import { DATASET_CATEGORIES } from '../datasets'

const shortLabel = c => (c.label || '').split('（')[0] || c.label

export default function DatasetTree({ value, onChange, categories = DATASET_CATEGORIES }) {
    const groupOf = v => categories.find(cat => cat.children.some(x => x.value === v))?.label
    const [openSet, setOpenSet] = useState(() => {
        const g = groupOf(value)
        return new Set(g ? [g] : [])
    })

    // value 变化（外部选中）时自动展开所在组
    useEffect(() => {
        const g = groupOf(value)
        if (g) setOpenSet(prev => prev.has(g) ? prev : new Set(prev).add(g))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value])

    const toggle = (label) => setOpenSet(prev => {
        const next = new Set(prev)
        if (next.has(label)) next.delete(label)
        else next.add(label)
        return next
    })

    return (
        <>
            {categories.map(cat => {
                const isOpen = openSet.has(cat.label)
                const isInCat = !!value && cat.children.some(x => x.value === value)
                return (
                    <div key={cat.label} style={{ marginBottom: 4 }}>
                        {/* 分组头：点击切换展开/折叠 */}
                        <div
                            onClick={() => toggle(cat.label)}
                            style={{
                                padding: '6px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 'bold',
                                color: isInCat ? '#1890ff' : '#ccc',
                                borderRadius: 4, userSelect: 'none',
                            }}
                        >
                            <span style={{ display: 'inline-block', width: 14 }}>{isOpen ? '▾' : '▸'}</span>
                            {cat.label}
                        </div>
                        {isOpen && (
                            <div style={{ paddingLeft: 24 }}>
                                {cat.children.map(c => {
                                    const sel = value === c.value
                                    return (
                                        <div
                                            key={c.value}
                                            onClick={() => onChange(c.value)}
                                            style={{
                                                padding: '6px 12px', cursor: 'pointer', fontSize: 13,
                                                color: sel ? '#1890ff' : '#fff',
                                                background: sel ? 'rgba(24,144,255,0.15)' : 'transparent',
                                                borderRadius: 4,
                                            }}
                                        >
                                            {shortLabel(c)}
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>
                )
            })}
        </>
    )
}
