import React from 'react'
import { 
    Card,
    Button
 } from 'antd'
import { FixedSizeGrid as Grid } from 'react-window'

export default function MatrixViewer({ frames }) {

  const Cell = ({
    columnIndex,
    rowIndex,
    style
  }) => {

    if (!frames.length) return null

    if (rowIndex === 0) {
      return (
        <div
          style={{
            ...style,
            background:'#fafafa',
            border:'1px solid #d9d9d9',
            display:'flex',
            alignItems:'center',
            justifyContent:'center',
            fontWeight:'bold'
          }}
        >
          {columnIndex === 0
            ? 'idx'
            : columnIndex - 1}
        </div>
      )
    }

    if (columnIndex === 0) {
      return (
        <div
          style={{
            ...style,
            background:'#f5f5f5',
            border:'1px solid #ddd',
            display:'flex',
            alignItems:'center',
            justifyContent:'center',
            fontWeight:'bold'
          }}
        >
          {rowIndex - 1}
        </div>
      )
    }

    return (
      <div
        style={{
          ...style,
          border:'1px solid #eee',
          display:'flex',
          alignItems:'center',
          justifyContent:'center'
        }}
      >
        {
          frames[rowIndex - 1]?.[
            columnIndex - 1
          ]
        }
      </div>
    )
  }

  const exportCSV = () => {

    if (!frames?.length) return

    const csvContent = frames
        .map(row => row.join(','))
        .join('\n')

    const blob = new Blob(
        [csvContent],
        {
        type: 'text/csv;charset=utf-8;'
        }
    )

    const url =
        URL.createObjectURL(blob)

    const link =
        document.createElement('a')

    link.href = url

    link.download = 'matrix.csv'

    link.click()

    URL.revokeObjectURL(url)
    }

  return (

    <Card
        title="Virtual Matrix Viewer"

        extra={
            <Button
            type="primary"
            onClick={exportCSV}
            >
            Export CSV
            </Button>
        }

        bodyStyle={{
            padding:0
        }}
        >

      <Grid
        columnCount={
          (frames[0]?.length || 0) + 1
        }
        columnWidth={100}
        height={700}
        rowCount={frames.length + 1}
        rowHeight={35}
        width={1400}
      >
        {Cell}
      </Grid>

    </Card>
  )
}