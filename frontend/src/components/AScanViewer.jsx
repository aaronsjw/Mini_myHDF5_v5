import React from 'react'
import {
  Card,
  Slider,
  Button,
  Tag,
  InputNumber
} from 'antd'

import ReactECharts from 'echarts-for-react'

export default function AScanViewer({

  frames,
  wave,

  frameIndex,
  setFrameIndex,

  setWave,

  playing,
  setPlaying,

  playSpeed,
  setPlaySpeed

}) {

  const updateFrame = idx => {

    setFrameIndex(idx)

    if (frames[idx]) {
      setWave(frames[idx])
    }
  }

  return (

    <>

      {frames.length > 0 && (

        <Card
          title={`A-Scan Frame ${frameIndex}`}
          style={{
            marginBottom:20
          }}
        >

          <Slider
            min={0}
            max={frames.length - 1}
            value={frameIndex}
            onChange={updateFrame}
          />

          <div
            style={{
              display:'flex',
              gap:10,
              marginTop:20,
              alignItems:'center'
            }}
          >

            <Button
              onClick={() =>
                updateFrame(
                  Math.max(
                    frameIndex - 1,
                    0
                  )
                )
              }
            >
              Prev
            </Button>

            <Button
              type="primary"
              onClick={() =>
                setPlaying(true)
              }
            >
              ▶ Play
            </Button>

            <Button
              danger
              onClick={() =>
                setPlaying(false)
              }
            >
              ■ Stop
            </Button>

            <Button
              onClick={() =>
                updateFrame(
                  Math.min(
                    frameIndex + 1,
                    frames.length - 1
                  )
                )
              }
            >
              Next
            </Button>

            <Tag color="blue">
              {frameIndex + 1}
              /
              {frames.length}
            </Tag>

            <InputNumber
              min={20}
              max={1000}
              value={playSpeed}
              onChange={v =>
                setPlaySpeed(v || 100)
              }
              addonAfter="ms"
            />

          </div>

        </Card>

      )}

      {wave.length > 0 && (

        <Card title="A-Scan Waveform">

          <ReactECharts
            option={{
              tooltip:{},
              xAxis:{
                type:'category',
                data:wave.map(
                  (_,i)=>i
                )
              },
              yAxis:{
                type:'value',
                min:-2000,
                max:2000
              },
              series:[
                {
                  type:'line',
                  smooth:true,
                  data:wave
                }
              ]
            }}
            style={{
              height:400
            }}
          />

        </Card>

      )}

    </>
  )
}