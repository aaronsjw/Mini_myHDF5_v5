
# Mini-myHDF5 v4 NDE Edition

## Features

- HDF5 / CSV / NDE viewer
- Real tree structure
- JSON pretty viewer
- A-Scan waveform viewer
- B-Scan heatmap viewer
- [64,1,2000] tensor support
- Frame slider
- Dataset metadata
- attrs viewer
- Industrial dark UI

## Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```

## Frontend

```bash
cd frontend
npm install
npm run dev
```
