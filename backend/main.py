
from fastapi import FastAPI, UploadFile, File
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
import tempfile
import os
import json
import h5py
import numpy as np
import pandas as pd

app = FastAPI()

from pydantic import BaseModel
import h5py

class DefectTypeRequest(BaseModel):
    path: str
    defectType: str



app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

current_file = None
current_filename = "modified.nde"

@app.post("/upload")
async def upload(file: UploadFile = File(...)):
    global current_file
    global current_filename

    suffix = os.path.splitext(file.filename)[1]

    temp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)

    temp.write(await file.read())
    temp.close()

    current_file = temp.name
    current_filename = file.filename

    return {"message": "uploaded"}

def build_tree(group, path="/"):

    result = []

    for key in group.keys():

        obj = group[key]

        current_path = path + key

        if isinstance(obj, h5py.Group):

            result.append({
                "title": key,
                "key": current_path,
                "path": current_path,
                "children": build_tree(obj, current_path + "/")
            })

        else:

            result.append({
                "title": key,
                "key": current_path,
                "path": current_path,
                "isLeaf": True
            })

    return result

@app.get("/tree")
def tree():

    global current_file

    if current_file.endswith(".csv"):

        df = pd.read_csv(current_file)

        return [
            {
                "title": c,
                "key": c,
                "path": c,
                "isLeaf": True
            }
            for c in df.columns
        ]

    with h5py.File(current_file, "r") as f:
        return build_tree(f)

@app.get("/dataset")
def dataset(path: str):

    global current_file

    if current_file.endswith(".csv"):

        df = pd.read_csv(current_file)

        arr = df[path].values

        return {
            "type": "waveform",
            "shape": list(arr.shape),
            "dtype": str(arr.dtype),
            "data": arr[:4000].tolist()
        }

    with h5py.File(current_file, "r") as f:

        obj = f[path]

        attrs = {}

        for k, v in obj.attrs.items():
            attrs[k] = str(v)

        if isinstance(obj, h5py.Group):

            return {
                "type": "group",
                "children": list(obj.keys()),
                "attrs": attrs
            }

        data = obj[()]

        # bytes -> json pretty
        if isinstance(data, bytes):

            try:

                decoded = data.decode("utf-8")

                try:
                    parsed = json.loads(decoded)

                    return {
                        "type": "json",
                        **parsed,
                        "attrs": attrs
                    }

                except:

                    return {
                        "type": "text",
                        "data": decoded,
                        "attrs": attrs
                    }

            except:

                return {
                    "type": "bytes",
                    "data": str(data),
                    "attrs": attrs
                }

        if isinstance(data, np.ndarray):

            # 1D waveform
            if data.ndim == 1:

                return {
                    "type": "waveform",
                    "shape": list(data.shape),
                    "dtype": str(data.dtype),
                    "attrs": attrs,
                    "data": data[:4000].tolist()
                }

            # 2D image
            if data.ndim == 2:

                return {
                    "type": "image",
                    "shape": list(data.shape),
                    "dtype": str(data.dtype),
                    "attrs": attrs,
                    "image": data.tolist()
                }

            # NDE tensor [64,1,2000]
            if data.ndim == 3:

                squeezed = np.squeeze(data)

                if squeezed.ndim == 2:

                    return {
                        "type": "nde_tensor",
                        "shape": list(data.shape),
                        "squeezed_shape": list(squeezed.shape),
                        "dtype": str(data.dtype),
                        "attrs": attrs,
                        "bscan": squeezed.tolist(),
                        "ascan": squeezed[0].tolist()
                    }

            return {
                "type": "ndarray",
                "shape": list(data.shape),
                "dtype": str(data.dtype),
                "attrs": attrs,
                "preview": data.flatten()[:100].tolist()
            }

        return {
            "type": "scalar",
            "data": str(data),
            "attrs": attrs
        }

@app.post("/save_defect_type")
async def save_defect_type(req: DefectTypeRequest):

    print(
        "SAVE REQUEST",
        req.path,
        req.defectType
    )

    global current_file

    try:

        with h5py.File(current_file, "r+") as f:

            print(
                "OPEN DATASET",
                req.path
            )

            ds = f[req.path]
            print("SAVE PATH =", req.path)
            

            raw = ds[()]

            if isinstance(raw, bytes):

                obj = json.loads(
                    raw.decode("utf-8")
                )

                # obj["defectType"] = req.defectType
                # print(
                #     "OLD:",
                #     obj
                # )

                

                # ds[()] = json.dumps(
                #     obj,
                #     ensure_ascii=False
                # ).encode("utf-8")

                obj["defectType"] = req.defectType

                print(
                    "NEW JSON:",
                    obj
                )

                new_json = json.dumps(
                    obj,
                    ensure_ascii=False
                ).encode("utf-8")

                print(
                    "WRITE:",
                    new_json[:200]
                )

                ds[()] = new_json

                verify = ds[()]

                print(
                    "VERIFY:",
                    verify[:200]
                )

                print("SAVE DONE")

                return {
                    "success": True
                }

            return {
                "success": False,
                "error": "Dataset is not JSON bytes"
            }

    except Exception as e:

        return {
            "success": False,
            "error": str(e)
        }
    

@app.get("/download_nde")
def download_nde():
    global current_file
    global current_filename

    if current_file is None or current_filename is None:
        return {"error": "No file uploaded"}

    # 从原始文件名中替换 label
    import re

    # 假设文件名格式: CF_EP_Plate_WRUT_OK_Z409-20260602153945.nde
    # 找到中间的标签部分（OK / Dl / Db ...）
    new_label = None
    with h5py.File(current_file, "r") as f:
        # 尝试读取 /Private/GlobalLabel 的 defectType
        try:
            raw = f["/Private/GlobalLabel"][()]
            if isinstance(raw, bytes):
                obj = json.loads(raw.decode("utf-8"))
                new_label = obj.get("defectType", None)
        except:
            pass

    filename = current_filename
    if new_label:
        filename = re.sub(r'_(OK|Dl|Db|Po|Vo|In|Fb|Rs|Uc)_', f'_{new_label}_', filename)

    return FileResponse(
        path=current_file,
        filename=filename,
        media_type="application/octet-stream"
    )