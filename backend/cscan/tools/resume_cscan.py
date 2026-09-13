"""从 cscan_v1 上次中断点 (epoch 140/150) 恢复训练。"""
import os
from pathlib import Path

# backend/cscan_tools → 仓库根 / backend
REPO = Path(__file__).resolve().parents[3]
BACKEND = REPO / "backend"
DS_DIR = REPO / "dataset" / "cscan_dataset"   # 含 dataset.yaml
RUNS_DIR = BACKEND / "storage" / "cscan" / "runs"             # 训练产物（已迁出 dataset）


def main():
    os.chdir(DS_DIR)
    print("cwd:", os.getcwd())

    from ultralytics import YOLO

    model = YOLO(str(RUNS_DIR / "cscan_v1/weights/last.pt"))
    model.train(resume=True)
    print("RESUME_DONE")


if __name__ == "__main__":
    # Windows 下 dataloader 用 spawn 起子进程，必须加 main 保护
    main()
