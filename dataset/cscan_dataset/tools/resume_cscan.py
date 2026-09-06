"""从 cscan_v1 上次中断点 (epoch 140/150) 恢复训练。"""
import os
from pathlib import Path

# cscan_dataset 根目录（含 dataset.yaml）
base = Path(__file__).resolve().parent.parent


def main():
    os.chdir(base)
    print("cwd:", os.getcwd())

    from ultralytics import YOLO

    model = YOLO(str(base / "runs/cscan_v1/weights/last.pt"))
    model.train(resume=True)
    print("RESUME_DONE")


if __name__ == "__main__":
    # Windows 下 dataloader 用 spawn 起子进程，必须加 main 保护
    main()
