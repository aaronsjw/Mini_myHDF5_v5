import React from 'react'
import {
  Card,
  Button,
  Tag,
  Select,
  Space,
  message
} from 'antd'

import axios from 'axios'
import { useState, useEffect } from 'react'

import ReactJson from 'react-json-view'


export default function InspectPanel({
  info,
  editableJson,
  handleJsonEdit,
  saveAsJson,
  currentPath
}) {

    const [defectType, setDefectType] =
        useState('OK')

    useEffect(() => {

    if (
        editableJson &&
        editableJson.defectType !== undefined
    ) {
        setDefectType(
        editableJson.defectType
        )
    }

    }, [editableJson])

  return (

    <Card
      title="Dataset Info"
      extra={
        <Button
          type="primary"
          onClick={saveAsJson}
        >
          Save As
        </Button>
      }
    >

      <Tag color="blue">
        {info.type}
      </Tag>

      <div style={{ marginTop:15, height: 'calc(100vh - 220px)', overflow: 'auto' }}>

      {
        editableJson?.defectType !== undefined && (

            <Card
            size="small"
            title="Defect Type Label"
            style={{
                marginBottom:16
            }}
            >

            <Space>

                <Select

                value={defectType}

                style={{ width: 150 }}

                onChange={(v) => {
                    setDefectType(v);
                    handleJsonEdit({ updated_src: { ...editableJson, defectType: v } });
                }}

                options={[

                    { value:'OK', label:'OK 好区' },

                    { value:'Dl', label:'Dl 分层' },

                    { value:'Db', label:'Db 脱粘' },

                    { value:'Po', label:'Po 孔隙' },

                    { value:'Vo', label:'Vo 气孔' },

                    { value:'In', label:'In 夹杂' },

                    { value:'Fb', label:'Fb 纤维相关' },

                    { value:'Rs', label:'Rs 树脂相关' },

                    { value:'Uc', label:'Uc 不可识别' }

                ]}
                />

                {/* <Button

                type="primary"

                onClick={async () => {

                    console.log(
                    'SAVE',
                    currentPath,
                    defectType
                    )

                    const res =
                    await axios.post(
                        'http://127.0.0.1:8000/save_defect_type',
                        {
                        path: currentPath,
                        defectType
                        }
                    )

                    console.log(res.data)

                    if (res.data.success) {

                    message.success(
                        'Saved'
                    )

                    } else {

                    message.error(
                        res.data.error
                    )

                    }

                }}
                >
                Save To NDE
                </Button> */}

                <Button
                    type="primary"
                    onClick={async () => {

                        const res =
                        await axios.post(
                            'http://127.0.0.1:8000/save_defect_type',
                            {
                            path: currentPath,
                            defectType
                            }
                        )

                        if (!res.data.success) {

                        message.error(
                            res.data.error
                        )

                        return
                        }

                        message.success(
                        'Saved'
                        )

                        const link =
                        document.createElement('a')

                        link.href =
                        'http://127.0.0.1:8000/download_nde'

                        link.download =
                        'modified.nde'

                        link.click()

                    }}
                    >
                    Save & Download
                    </Button>

            </Space>

            </Card>

        )
        }

        <ReactJson
          src={
            editableJson || info
          }
          theme="monokai"
          collapsed={2}
          enableClipboard={false}
          displayDataTypes={false}
          displayObjectSize={false}
          quotesOnKeys={false}
          name={false}
          onEdit={handleJsonEdit}
          onAdd={handleJsonEdit}
          onDelete={handleJsonEdit}
        />

      </div>

    </Card>
  )
}

