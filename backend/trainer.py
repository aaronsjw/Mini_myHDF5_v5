"""
模型训练引擎
- 从 dataset/ 目录加载 .nde 文件
- 提取统计特征
- 训练 RandomForest 分类器
- 保存/加载模型
"""
import os, json, time, uuid, threading, re
from datetime import datetime

import h5py
import numpy as np

# ── 传统机器学习 ──
import joblib
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import (
    accuracy_score, classification_report, confusion_matrix
)

# ── 深度学习 ──
try:
    import torch
    import torch.nn as nn
    import torch.optim as optim
    from torch.utils.data import Dataset, DataLoader
    DEEP_LEARNING_AVAILABLE = True
except ImportError:
    DEEP_LEARNING_AVAILABLE = False
    import warnings
    warnings.warn("PyTorch 未安装，深度学习模型不可用")

# ─── 配置 ───────────────────────────────────────────
BASE_DIR = os.path.join(os.path.dirname(__file__), "..", "dataset")
MODEL_DIR = os.path.join(os.path.dirname(__file__), "models")
os.makedirs(MODEL_DIR, exist_ok=True)

# 命名规则正则（用于从文件名获取标签）
FILENAME_PATTERN = re.compile(
    r"^(\w+)_(\w+)_(\w+)_(\w+)_(\w+)_(\w+)_(\d{14})_(.+)\.nde$"
)


# ─── 特征提取 ─────────────────────────────────────
MAX_ASCAN_LINES = 64  # 统一行数（不足补0，超出截断）

# 元数据类别编码（用于 RandomForest 特征增强）
META_CATEGORIES = {
    "fiber": ["CF", "GF"],
    "fiberGrade": ["ZT9H", "QW280"],
    "matrixGrade": ["1316", "AC319"],
    "structure": ["BondPP", "Plate"],
}
META_FEATURE_DIM = sum(len(v) for v in META_CATEGORIES.values())  # = 8 维 onehot


def encode_metadata(label_obj: dict, material_obj: dict) -> np.ndarray:
    """
    从 GlobalLabel 和 MaterialInfo 提取元数据，编码为 one-hot 向量。
    返回 shape [8,] 的向量。
    """
    import warnings
    values = {}
    # GlobalLabel 中的字段
    values["structure"] = label_obj.get("structure", None)
    # MaterialInfo 中的字段
    if material_obj:
        values["fiber"] = material_obj.get("fiber", None)
        values["fiberGrade"] = material_obj.get("fiberGrade", None)
        values["matrixGrade"] = material_obj.get("matrixGrade", None)
    else:
        values["fiber"] = label_obj.get("fiber", None)
        values["fiberGrade"] = label_obj.get("fiberGrade", None)
        values["matrixGrade"] = label_obj.get("matrixGrade", None)

    vec = []
    for field, cats in META_CATEGORIES.items():
        val = values.get(field)
        # one-hot 编码
        onehot = [1.0 if val == c else 0.0 for c in cats]
        if not any(onehot):
            # 未知值全部归零
            onehot = [0.0] * len(cats)
        vec.extend(onehot)
    return np.array(vec, dtype=np.float32)

def extract_features(data: np.ndarray) -> np.ndarray:
    """
    从 B-scan [N, 2000] 提取 390 维统计特征向量。
    - 前 384 维: 每行 A-scan 的 6 种统计量 × 64 行（不足补0，超出截断）
    - 后 6 维: 全局统计量
    """
    n_lines = data.shape[0]
    # 截断或填充到 MAX_ASCAN_LINES
    if n_lines >= MAX_ASCAN_LINES:
        sliced = data[:MAX_ASCAN_LINES, :]
    else:
        padded = np.zeros((MAX_ASCAN_LINES, data.shape[1]), dtype=data.dtype)
        padded[:n_lines, :] = data
        sliced = padded

    features = []
    for i in range(MAX_ASCAN_LINES):
        row = sliced[i]
        features.extend([
            float(np.mean(row)),
            float(np.std(row)),
            float(np.max(row)),
            float(np.min(row)),
            float(np.max(row) - np.min(row)),
            float(np.sqrt(np.mean(row ** 2)))
        ])
    # 全局特征
    flat = data.flatten()
    features.extend([
        float(np.mean(flat)),
        float(np.std(flat)),
        float(np.max(flat)),
        float(np.min(flat)),
        float(np.max(flat) - np.min(flat)),
        float(np.sqrt(np.mean(flat ** 2)))
    ])
    return np.array(features, dtype=np.float32)


def get_dataset_path(f: h5py.File) -> str:
    """在 HDF5 文件中查找主数据张量的路径（3D 且含 AScanAmplitude）"""
    # 优先已知路径
    candidates = [
        "Public/Groups/0/Datasets/0-AScanAmplitude",
        "0-AScanAmplitude",
        "AScanAmplitude",
    ]
    for c in candidates:
        if c in f:
            return c
    # 兜底: 遍历找第一个 3D dataset
    def finder(name, obj):
        if isinstance(obj, h5py.Dataset) and obj.ndim == 3:
            raise StopIteration(name)
    try:
        f.visititems(finder)
    except StopIteration as e:
        return str(e)
    return None


# ─── 数据加载 ─────────────────────────────────────
def load_dataset(base_dir=None, max_files=None, progress_callback=None,
                 use_metadata=True):
    """
    扫描 dataset/ 子目录，加载 .nde 文件。
    返回 X, y, class_names, file_count
    当 use_metadata=True 时，X 包含信号特征 + 元数据特征（共 398 维）
    """
    if base_dir is None:
        base_dir = BASE_DIR
    X_list, y_list, file_paths = [], [], []
    class_names = set()

    # 找出有数据的缺陷目录
    defect_dirs = sorted([
        d for d in os.listdir(base_dir)
        if os.path.isdir(os.path.join(base_dir, d))
    ])

    total_files = 0
    for dd in defect_dirs:
        dir_path = os.path.join(base_dir, dd)
        nde_files = [f for f in os.listdir(dir_path) if f.lower().endswith('.nde')]
        total_files += len(nde_files)

    loaded = 0
    for dd in defect_dirs:
        dir_path = os.path.join(base_dir, dd)
        nde_files = sorted([f for f in os.listdir(dir_path) if f.lower().endswith('.nde')])
        if not nde_files:
            continue

        for fname in nde_files:
            if max_files and loaded >= max_files:
                break
            fpath = os.path.join(dir_path, fname)
            try:
                with h5py.File(fpath, 'r') as f:
                    # 取标签（优先从 GlobalLabel 读，兜底用目录名）
                    try:
                        raw = f["Private/GlobalLabel"][()]
                        label_obj = json.loads(raw.decode("utf-8"))
                        label = label_obj.get("defectType", dd)
                    except Exception:
                        label_obj = {}
                        label = dd

                    # 取 MaterialInfo
                    try:
                        raw = f["Private/MaterialInfo"][()]
                        material_obj = json.loads(raw.decode("utf-8"))
                    except Exception:
                        material_obj = {}

                    # 取数据张量
                    ds_path = get_dataset_path(f)
                    if ds_path is None:
                        continue
                    data = f[ds_path][()]
                    data = np.squeeze(data)  # [64,1,2000] → [64,2000]
                    if data.ndim != 2:
                        continue

                    # 信号特征 + 元数据特征
                    signal_feats = extract_features(data)
                    if use_metadata:
                        meta_feats = encode_metadata(label_obj, material_obj)
                        feats = np.concatenate([signal_feats, meta_feats])
                    else:
                        feats = signal_feats

                    X_list.append(feats)
                    y_list.append(label)
                    rel_path = os.path.relpath(fpath, base_dir).replace("\\", "/")
                    file_paths.append(rel_path)
                    class_names.add(label)
                    loaded += 1

                    if progress_callback and total_files > 0:
                        progress_callback(int(loaded / total_files * 80))
            except Exception as e:
                print(f"  [skip] {fname}: {e}")
                continue

    X = np.array(X_list)
    y = np.array(y_list)
    class_list = sorted(class_names)
    return X, y, class_list, loaded, file_paths


# ─── 模型训练 ─────────────────────────────────────
def train_model(X, y, test_size=0.2, n_estimators=100, max_depth=None,
                progress_callback=None):
    """
    训练 RandomForest 分类器。
    返回 model, metrics
    """
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=test_size, random_state=42, stratify=y
    )

    if progress_callback:
        progress_callback(85)

    model = RandomForestClassifier(
        n_estimators=n_estimators,
        max_depth=max_depth,
        random_state=42,
        n_jobs=-1,
        verbose=0
    )
    model.fit(X_train, y_train)

    if progress_callback:
        progress_callback(92)

    y_pred = model.predict(X_test)
    acc = accuracy_score(y_test, y_pred)
    cm = confusion_matrix(y_test, y_pred)
    report = classification_report(y_test, y_pred, output_dict=True)

    if progress_callback:
        progress_callback(98)

    metrics = {
        "model_type": "random_forest",
        "accuracy": float(acc),
        "test_size": test_size,
        "n_estimators": n_estimators,
        "max_depth": max_depth,
        "n_samples": len(y),
        "n_features": X.shape[1],
        "class_names": sorted(set(y.tolist())),
        "classification_report": report,
        "confusion_matrix": cm.tolist(),
        "confusion_matrix_labels": sorted(set(y_test.tolist())),
    }

    return model, metrics


def save_model(model, metrics):
    """保存模型和指标到 models/ 目录"""
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    classes = "_".join(metrics["class_names"])
    acc = metrics["accuracy"]
    model_name = f"rf_{classes}_{acc:.3f}_{ts}"
    model_path = os.path.join(MODEL_DIR, f"{model_name}.pkl")
    meta_path = os.path.join(MODEL_DIR, f"{model_name}.json")

    joblib.dump(model, model_path)
    metrics["model_name"] = model_name
    metrics["model_file"] = model_name + ".pkl"
    metrics["saved_at"] = ts
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(metrics, f, ensure_ascii=False, indent=2)

    return model_name, model_path


def list_models():
    """列出已保存的所有模型及其指标"""
    models = []
    for fname in sorted(os.listdir(MODEL_DIR)):
        if fname.endswith(".json"):
            path = os.path.join(MODEL_DIR, fname)
            try:
                with open(path, "r", encoding="utf-8") as f:
                    meta = json.load(f)
                models.append(meta)
            except Exception:
                continue
    return sorted(models, key=lambda m: m.get("saved_at", ""), reverse=True)


def delete_model(model_name):
    """删除模型文件"""
    for ext in [".pkl", ".json"]:
        path = os.path.join(MODEL_DIR, model_name + ext)
        if os.path.exists(path):
            os.remove(path)


# ══════════════════════════════════════════════════
# 深度学习模型（CNN + BiLSTM + Transformer）
# ══════════════════════════════════════════════════

class DeepNDEClassifier(nn.Module):
    """
    CNN + BiLSTM + Transformer 混合模型

    架构:
      Input [B, 64, 2000]
        → InstanceNorm (逐样本归一化)
        → CNN per A-scan (1D Conv) → [B, 64, cnn_dim]
        → BiLSTM → [B, 64, lstm_dim]
        → Transformer → [B, 64, tf_dim]
        → Mean Pool → [B, tf_dim] → FC → [B, n_classes]
    """
    def __init__(self, n_classes: int, cnn_dim=64, lstm_hidden=128,
                 tf_heads=4, tf_layers=1, dropout=0.3):
        super().__init__()

        # ── 输入归一化 ──
        self.inst_norm = nn.InstanceNorm1d(2000, affine=True)

        # ── CNN 编码器（逐 A-scan 提取特征） ──
        # 输入: [B*64, 1, 2000]  →  输出: [B*64, cnn_dim]
        self.cnn = nn.Sequential(
            nn.Conv1d(1, 32, kernel_size=7, stride=2, padding=3),   # 2000→1000
            nn.BatchNorm1d(32), nn.ReLU(),
            nn.Conv1d(32, 64, kernel_size=5, stride=2, padding=2),  # 1000→500
            nn.BatchNorm1d(64), nn.ReLU(),
            nn.Conv1d(64, cnn_dim, kernel_size=3, stride=2, padding=1),  # 500→250
            nn.BatchNorm1d(cnn_dim), nn.ReLU(),
            nn.AdaptiveAvgPool1d(1),  # 250→1
        )

        # ── BiLSTM ──
        self.lstm = nn.LSTM(
            input_size=cnn_dim,
            hidden_size=lstm_hidden,
            num_layers=1,
            batch_first=True,
            bidirectional=True,
            dropout=0,
        )
        lstm_out = lstm_hidden * 2

        # ── Transformer ──
        tf_layer = nn.TransformerEncoderLayer(
            d_model=lstm_out,
            nhead=tf_heads,
            dim_feedforward=lstm_out * 2,
            dropout=dropout,
            batch_first=True,
            activation='gelu',
        )
        self.transformer = nn.TransformerEncoder(tf_layer, num_layers=tf_layers)

        # ── 分类头 ──
        self.classifier = nn.Sequential(
            nn.LayerNorm(lstm_out),
            nn.Dropout(dropout),
            nn.Linear(lstm_out, n_classes),
        )

    def forward(self, x):
        """
        x: [B, 64, 2000]  或  [B, 1, 64, 2000]
        """
        # 统一形状
        if x.dim() == 4:
            x = x.squeeze(1)               # [B, 64, 2000]

        B, S, L = x.shape                  # B=batch, S=64行, L=2000

        # 逐样本归一化（对每行 A-scan 做 InstanceNorm）
        x = x.permute(0, 2, 1)             # [B, 2000, 64]
        x = self.inst_norm(x)              # [B, 2000, 64]
        x = x.permute(0, 2, 1)             # [B, 64, 2000]

        # CNN: 每行 A-scan 独立编码
        x = x.reshape(B * S, 1, L)         # [B*64, 1, 2000]
        x = self.cnn(x)                    # [B*64, cnn_dim]
        x = x.reshape(B, S, -1)            # [B, 64, cnn_dim]

        # LSTM
        x, _ = self.lstm(x)                # [B, 64, lstm_hidden*2]

        # Transformer
        x = self.transformer(x)            # [B, 64, lstm_hidden*2]

        # 序列池化
        x = x.mean(dim=1)                  # [B, lstm_hidden*2]

        # 分类头
        return self.classifier(x)          # [B, n_classes]


class NDEDataset(Dataset):
    """原始 2D 数据 PyTorch Dataset（自动逐样本归一化）"""
    def __init__(self, X, y, class_to_idx):
        # 逐样本 z-score 归一化
        X = X.astype(np.float32)
        mean = X.mean(axis=(1, 2), keepdims=True)
        std = X.std(axis=(1, 2), keepdims=True) + 1e-8
        X = (X - mean) / std

        self.X = torch.from_numpy(X).float()
        self.y = torch.tensor([class_to_idx[v] for v in y], dtype=torch.long)

    def __len__(self):
        return len(self.y)

    def __getitem__(self, idx):
        return self.X[idx], self.y[idx]


class InferenceDataset(Dataset):
    """仅用于推理的 Dataset（不需要标签）"""
    def __init__(self, X):
        X = X.astype(np.float32)
        mean = X.mean(axis=(1, 2), keepdims=True)
        std = X.std(axis=(1, 2), keepdims=True) + 1e-8
        X = (X - mean) / std
        self.X = torch.from_numpy(X).float()

    def __len__(self):
        return len(self.X)

    def __getitem__(self, idx):
        return self.X[idx]


def _standardize_2d(data, target_rows=64, target_cols=2000):
    """将 2D 数组填充/截断到统一尺寸 [target_rows, target_cols]"""
    rows, cols = data.shape
    # 行方向
    if rows >= target_rows:
        out = data[:target_rows, :]
    else:
        out = np.zeros((target_rows, cols), dtype=data.dtype)
        out[:rows, :] = data
    # 列方向
    if cols >= target_cols:
        out = out[:, :target_cols]
    else:
        padded = np.zeros((target_rows, target_cols), dtype=out.dtype)
        padded[:, :cols] = out
        out = padded
    return out


def load_dataset_raw(base_dir=None, max_files=None, progress_callback=None):
    """
    加载原始 2D 信号数据（不提取统计特征）。
    返回 X_raw, y, class_list, loaded_count
      X_raw: [n, 64, 2000]
      y:     [n] 字符串标签
    """
    if base_dir is None:
        base_dir = BASE_DIR
    X_list, y_list, file_paths = [], [], []
    class_set = set()

    # 扫描缺陷目录
    defect_dirs = sorted([
        d for d in os.listdir(base_dir)
        if os.path.isdir(os.path.join(base_dir, d))
    ])

    total_files = sum(
        len([f for f in os.listdir(os.path.join(base_dir, dd))
             if f.lower().endswith('.nde')])
        for dd in defect_dirs
    )

    loaded = 0
    for dd in defect_dirs:
        dir_path = os.path.join(base_dir, dd)
        nde_files = sorted([f for f in os.listdir(dir_path) if f.lower().endswith('.nde')])
        if not nde_files:
            continue

        for fname in nde_files:
            if max_files and loaded >= max_files:
                break
            fpath = os.path.join(dir_path, fname)
            try:
                with h5py.File(fpath, 'r') as f:
                    # 取标签
                    try:
                        raw = f["Private/GlobalLabel"][()]
                        label_obj = json.loads(raw.decode("utf-8"))
                        label = label_obj.get("defectType", dd)
                    except Exception:
                        label = dd

                    # 取数据
                    ds_path = get_dataset_path(f)
                    if ds_path is None:
                        continue
                    data = f[ds_path][()]
                    data = np.squeeze(data)      # [64,1,2000] → [64,2000]
                    if data.ndim != 2:
                        continue

                    # 统一尺寸到 [64, 2000]
                    data = _standardize_2d(data)

                    X_list.append(data)
                    y_list.append(label)
                    rel_path = os.path.relpath(fpath, base_dir).replace("\\", "/")
                    file_paths.append(rel_path)
                    class_set.add(label)
                    loaded += 1

                    if progress_callback and total_files > 0:
                        progress_callback(int(loaded / total_files * 80))
            except Exception as e:
                print(f"  [skip] {fname}: {e}")
                continue

    X = np.stack(X_list, axis=0)
    return X, np.array(y_list), sorted(class_set), loaded, file_paths


def train_deep_model(X, y, class_list, epochs=20, batch_size=16, lr=1e-3,
                     test_size=0.2, progress_callback=None):
    """
    训练 DeepNDEClassifier。
    返回 model (state_dict), metrics
    """
    if not DEEP_LEARNING_AVAILABLE:
        raise RuntimeError("PyTorch 未安装，无法训练深度学习模型")

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    class_to_idx = {c: i for i, c in enumerate(class_list)}
    n_classes = len(class_list)

    # 数据集划分
    from sklearn.model_selection import train_test_split as tts
    X_train, X_test, y_train, y_test = tts(
        X, y, test_size=test_size, random_state=42, stratify=y
    )

    train_ds = NDEDataset(X_train, y_train, class_to_idx)
    test_ds = NDEDataset(X_test, y_test, class_to_idx)

    train_loader = DataLoader(train_ds, batch_size=batch_size, shuffle=True)
    test_loader = DataLoader(test_ds, batch_size=batch_size * 2)

    # 初始化模型
    model = DeepNDEClassifier(n_classes=n_classes).to(device)
    criterion = nn.CrossEntropyLoss()
    optimizer = optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-4)
    scheduler = optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)

    best_acc = 0.0
    best_state = None
    history = []

    total_steps = epochs * len(train_loader)
    step = 0

    for epoch in range(epochs):
        # ── 训练 ──
        model.train()
        train_loss = 0.0
        train_correct = 0
        train_total = 0

        for inputs, targets in train_loader:
            inputs, targets = inputs.to(device), targets.to(device)
            optimizer.zero_grad()
            outputs = model(inputs)
            loss = criterion(outputs, targets)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0)
            optimizer.step()

            train_loss += loss.item() * inputs.size(0)
            _, preds = torch.max(outputs, 1)
            train_correct += (preds == targets).sum().item()
            train_total += targets.size(0)

            step += 1
            if progress_callback:
                base_progress = 80 + int(step / total_steps * 15)
                progress_callback(min(base_progress, 95))

        scheduler.step()

        # ── 评估 ──
        model.eval()
        all_preds, all_targets = [], []
        test_loss = 0.0
        with torch.no_grad():
            for inputs, targets in test_loader:
                inputs, targets = inputs.to(device), targets.to(device)
                outputs = model(inputs)
                loss = criterion(outputs, targets)
                test_loss += loss.item() * inputs.size(0)
                _, preds = torch.max(outputs, 1)
                all_preds.extend(preds.cpu().tolist())
                all_targets.extend(targets.cpu().tolist())

        train_acc = train_correct / train_total
        test_acc = sum(1 for p, t in zip(all_preds, all_targets) if p == t) / len(all_targets)

        history.append({
            "epoch": epoch + 1,
            "train_loss": round(train_loss / train_total, 4),
            "train_acc": round(train_acc, 4),
            "test_loss": round(test_loss / len(test_ds), 4),
            "test_acc": round(test_acc, 4),
        })

        if test_acc > best_acc:
            best_acc = test_acc
            best_state = model.state_dict()

    if progress_callback:
        progress_callback(98)

    # 加载最佳模型计算最终指标
    model.load_state_dict(best_state)
    model.eval()

    idx_to_class = {i: c for c, i in class_to_idx.items()}
    all_preds, all_targets = [], []
    with torch.no_grad():
        for inputs, targets in test_loader:
            inputs, targets = inputs.to(device), targets.to(device)
            outputs = model(inputs)
            _, preds = torch.max(outputs, 1)
            all_preds.extend(preds.cpu().tolist())
            all_targets.extend(targets.cpu().tolist())

    all_pred_labels = [idx_to_class[p] for p in all_preds]
    all_true_labels = [idx_to_class[t] for t in all_targets]

    acc = sum(1 for p, t in zip(all_preds, all_targets) if p == t) / len(all_targets)
    cm = confusion_matrix(all_true_labels, all_pred_labels, labels=class_list)
    report = classification_report(all_true_labels, all_pred_labels,
                                   labels=class_list, output_dict=True)

    metrics = {
        "model_type": "deep_cnn_lstm_transformer",
        "accuracy": float(acc),
        "test_size": test_size,
        "epochs": epochs,
        "batch_size": batch_size,
        "learning_rate": lr,
        "n_classes": n_classes,
        "n_samples": len(y),
        "n_train": len(y_train),
        "n_test": len(y_test),
        "class_names": class_list,
        "classification_report": report,
        "confusion_matrix": cm.tolist(),
        "confusion_matrix_labels": class_list,
        "training_history": history,
    }

    # 返回 state_dict 供保存
    return best_state, metrics, model.state_dict()


def save_deep_model(state_dict, metrics, class_list):
    """保存 PyTorch 模型（torch.save + json 指标）"""
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    classes = "_".join(class_list)
    acc = metrics["accuracy"]
    model_name = f"deep_{classes}_{acc:.3f}_{ts}"

    model_path = os.path.join(MODEL_DIR, f"{model_name}.pt")
    meta_path = os.path.join(MODEL_DIR, f"{model_name}.json")

    torch.save(state_dict, model_path)
    metrics["model_name"] = model_name
    metrics["model_file"] = model_name + ".pt"
    metrics["saved_at"] = ts
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(metrics, f, ensure_ascii=False, indent=2)

    return model_name, model_path


# ─── 后台任务管理 ─────────────────────────────────
_tasks = {}  # {job_id: {status, progress, result, error}}


def _run_train(job_id, config):
    """后台线程执行训练（支持多种模型）"""
    task = _tasks[job_id]

    def progress_callback(pct):
        task["progress"] = pct

    model_type = config.get("model_type", "random_forest")

    try:
        task["status"] = "loading"
        task["progress"] = 0

        if model_type == "deep_cnn_lstm_transformer":
            # ── 深度学习分支 ──
            if not DEEP_LEARNING_AVAILABLE:
                raise RuntimeError("PyTorch 未安装，无法训练深度学习模型")

            X_raw, y, class_names, n_loaded, _ = load_dataset_raw(
                progress_callback=progress_callback
            )

            if n_loaded == 0:
                task["status"] = "error"
                task["error"] = "没有找到可用的 .nde 文件"
                return

            task["status"] = "training"
            task["progress"] = 80

            best_state, metrics, _ = train_deep_model(
                X_raw, y, class_names,
                epochs=config.get("epochs", 20),
                batch_size=config.get("batch_size", 16),
                lr=config.get("learning_rate", 0.001),
                test_size=config.get("test_size", 0.2),
                progress_callback=progress_callback
            )

            model_name, _ = save_deep_model(best_state, metrics, class_names)
            metrics["model_name"] = model_name
            task["status"] = "done"
            task["progress"] = 100
            task["result"] = metrics

        else:
            # ── 传统机器学习分支（RandomForest） ──
            use_meta = config.get("use_metadata", True)
            X, y, class_names, n_loaded, _ = load_dataset(
                progress_callback=progress_callback,
                use_metadata=use_meta,
            )

            if n_loaded == 0:
                task["status"] = "error"
                task["error"] = "没有找到可用的 .nde 文件"
                return

            task["status"] = "training"
            task["progress"] = 80

            model, metrics = train_model(
                X, y,
                test_size=config.get("test_size", 0.2),
                n_estimators=config.get("n_estimators", 100),
                max_depth=config.get("max_depth"),
                progress_callback=progress_callback
            )

            metrics["use_metadata"] = use_meta
            metrics["n_features_meta"] = META_FEATURE_DIM
            model_name, model_path = save_model(model, metrics)
            metrics["model_name"] = model_name
            task["status"] = "done"
            task["progress"] = 100
            task["result"] = metrics

    except Exception as e:
        task["status"] = "error"
        task["error"] = str(e)
        import traceback
        task["error"] += "\n" + traceback.format_exc()


def start_train(config: dict) -> str:
    """启动异步训练任务，返回 job_id"""
    job_id = uuid.uuid4().hex[:12]
    _tasks[job_id] = {
        "status": "pending",
        "progress": 0,
        "result": None,
        "error": None,
    }
    t = threading.Thread(target=_run_train, args=(job_id, config), daemon=True)
    t.start()
    return job_id


def get_status(job_id: str) -> dict:
    return _tasks.get(job_id, {"status": "not_found"})


def get_result(job_id: str) -> dict:
    task = _tasks.get(job_id)
    if task and task["status"] == "done":
        return task["result"]
    return None


# ─── 数据预览（不训练，只统计） ───────────────────
def preview_dataset(base_dir=None):
    """返回数据集统计信息，不加载完整数据"""
    if base_dir is None:
        base_dir = BASE_DIR
    if not os.path.isdir(base_dir):
        return {"error": "dataset directory not found"}

    result = {"by_defect": {}, "total_files": 0, "n_features": None, "n_features_total": None}
    for dd in sorted(os.listdir(base_dir)):
        dir_path = os.path.join(base_dir, dd)
        if not os.path.isdir(dir_path):
            continue
        nde_files = [f for f in os.listdir(dir_path) if f.lower().endswith('.nde')]
        if not nde_files:
            continue
        # 从第一个文件推断特征维度
        if result["n_features"] is None:
            try:
                fpath = os.path.join(dir_path, nde_files[0])
                with h5py.File(fpath, 'r') as f:
                    ds_path = get_dataset_path(f)
                    if ds_path:
                        data = f[ds_path][()]
                        data = np.squeeze(data)
                        signal_feats = extract_features(data)
                        result["n_features"] = len(signal_feats)
                        result["n_features_total"] = len(signal_feats) + META_FEATURE_DIM
            except Exception:
                pass

        result["by_defect"][dd] = {
            "count": len(nde_files),
            "label": dd
        }
        result["total_files"] += len(nde_files)

    return result


# ══════════════════════════════════════════════════
# 模型测试
# ══════════════════════════════════════════════════

_test_tasks = {}  # {job_id: {status, progress, result, error}}


def load_model_for_testing(model_name: str):
    """
    从 models/ 加载模型和 meta 信息。
    返回 (model, meta)
    """
    meta_path = os.path.join(MODEL_DIR, f"{model_name}.json")
    with open(meta_path, "r", encoding="utf-8") as f:
        meta = json.load(f)

    model_type = meta.get("model_type", "random_forest")

    if model_type == "deep_cnn_lstm_transformer":
        if not DEEP_LEARNING_AVAILABLE:
            raise RuntimeError("PyTorch 未安装，无法加载深度学习模型")
        model_path = os.path.join(MODEL_DIR, f"{model_name}.pt")
        # 重建模型
        class_list = meta["class_names"]
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        model = DeepNDEClassifier(n_classes=len(class_list)).to(device)
        model.load_state_dict(torch.load(model_path, map_location=device))
        model.eval()
    else:
        model_path = os.path.join(MODEL_DIR, f"{model_name}.pkl")
        model = joblib.load(model_path)

    return model, meta


def run_test(model, meta, X, y_true=None, file_paths=None):
    """
    对测试数据运行预测。
    X: [n, n_features] 或 [n, 64, 2000] (深度学习)
    y_true: 真实标签列表（可选）
    file_paths: 文件路径列表（可选）

    返回 dict:
      - predictions: 预测标签列表
      - probabilities: 每个类别的概率（RF）或 None（深度学习）
      - class_names: 类别列表
      - per_file: [{pred, true, correct, file_path, probabilities}, ...]
      - accuracy: 准确率（有真实标签时）
      - confusion_matrix: 混淆矩阵
      - classification_report: 分类报告
    """
    model_type = meta.get("model_type", "random_forest")
    class_names = meta["class_names"]
    class_to_idx = {c: i for i, c in enumerate(class_names)}
    idx_to_class = {i: c for i, c in enumerate(class_names)}

    if model_type == "deep_cnn_lstm_transformer":
        # 深度学习推理
        device = next(model.parameters()).device
        dataset = InferenceDataset(X)
        loader = DataLoader(dataset, batch_size=32, shuffle=False)
        all_preds, all_probs = [], []
        with torch.no_grad():
            for inputs in loader:
                inputs = inputs.to(device)
                outputs = model(inputs)
                probs = torch.softmax(outputs, dim=1)
                _, preds = torch.max(outputs, 1)
                all_preds.extend(preds.cpu().tolist())
                all_probs.extend(probs.cpu().tolist())
        pred_labels = [idx_to_class[p] for p in all_preds]
        prob_list = [[float(x) for x in p] for p in all_probs]
    else:
        # RandomForest 推理
        probs = model.predict_proba(X)
        preds = model.predict(X)
        pred_labels = [str(p) for p in preds]

        # sklearn predict_proba 返回每个类别的概率，但多类时是 list of arrays
        # 需要对齐到 class_names
        if hasattr(model, "classes_"):
            model_classes = list(model.classes_)
            prob_list = []
            for p in probs:
                prob_row = [0.0] * len(class_names)
                for i, c in enumerate(model_classes):
                    if c in class_to_idx:
                        prob_row[class_to_idx[c]] = float(p[i])
                prob_list.append(prob_row)
        else:
            prob_list = None

    # 逐文件结果
    per_file = []
    total_correct = 0
    total_with_label = 0
    for i, pred in enumerate(pred_labels):
        item = {"pred": pred, "probabilities": prob_list[i] if prob_list else None}
        if file_paths and i < len(file_paths):
            item["file_path"] = file_paths[i]
        if y_true is not None and i < len(y_true):
            true_label = y_true[i]
            item["true"] = true_label
            item["correct"] = pred == true_label
            if pred == true_label:
                total_correct += 1
            total_with_label += 1
        else:
            item["true"] = None
            item["correct"] = None
        per_file.append(item)

    result = {
        "predictions": pred_labels,
        "class_names": class_names,
        "per_file": per_file,
        "n_samples": len(pred_labels),
    }

    if total_with_label > 0:
        acc = total_correct / total_with_label
        true_labels = [y_true[i] for i in range(total_with_label)]
        pred_for_cm = [per_file[i]["pred"] for i in range(total_with_label)]
        cm = confusion_matrix(true_labels, pred_for_cm, labels=class_names)
        report = classification_report(true_labels, pred_for_cm,
                                       labels=class_names, output_dict=True)
        result["accuracy"] = float(acc)
        result["confusion_matrix"] = cm.tolist()
        result["confusion_matrix_labels"] = class_names
        result["classification_report"] = report
        result["error_files"] = [
            per_file[i]
            for i in range(total_with_label)
            if not per_file[i]["correct"]
        ]

    return result


def _run_test(job_id, config):
    """后台线程执行测试"""
    task = _test_tasks[job_id]

    def progress_callback(pct):
        task["progress"] = pct

    try:
        task["status"] = "loading"
        task["progress"] = 0

        model_name = config["model_name"]
        test_size = config.get("test_size", 1.0)  # 默认用全部数据测试

        # 加载模型
        model, meta = load_model_for_testing(model_name)
        task["progress"] = 10

        # 加载测试数据
        model_type = meta.get("model_type", "random_forest")
        use_meta = config.get("use_metadata", True)

        if model_type == "deep_cnn_lstm_transformer":
            X, y, class_names, n_loaded, file_paths = load_dataset_raw(
                progress_callback=lambda p: None
            )
        else:
            X, y, class_names, n_loaded, file_paths = load_dataset(
                progress_callback=lambda p: None,
                use_metadata=use_meta,
            )

        if n_loaded == 0:
            task["status"] = "error"
            task["error"] = "没有找到可用的 .nde 文件"
            return

        task["status"] = "testing"
        task["progress"] = 50

        # 可选：只取部分数据进行测试
        if test_size < 1.0:
            from sklearn.model_selection import train_test_split as tts
            _, X, _, y, _, file_paths = tts(
                X, y, file_paths,
                test_size=test_size, random_state=42, stratify=y
            )

        # 运行测试
        result = run_test(model, meta, X, y, file_paths=file_paths)

        task["status"] = "done"
        task["progress"] = 100
        result["model_name"] = model_name
        result["model_type"] = model_type
        result["model_accuracy"] = meta.get("accuracy", None)
        result["n_test_samples"] = len(y)
        task["result"] = result

    except Exception as e:
        task["status"] = "error"
        task["error"] = str(e)
        import traceback
        task["error"] += "\n" + traceback.format_exc()


def start_test(config: dict) -> str:
    """启动异步测试任务，返回 job_id"""
    job_id = uuid.uuid4().hex[:12]
    _test_tasks[job_id] = {
        "status": "pending",
        "progress": 0,
        "result": None,
        "error": None,
    }
    t = threading.Thread(target=_run_test, args=(job_id, config), daemon=True)
    t.start()
    return job_id


def get_test_status(job_id: str) -> dict:
    return _test_tasks.get(job_id, {"status": "not_found"})


def get_test_result(job_id: str) -> dict:
    task = _test_tasks.get(job_id)
    if task and task["status"] == "done":
        return task["result"]
    return None


def load_file_for_preview(rel_path: str) -> dict:
    """加载 .nde 文件返回 B-scan 和 A-scan 预览数据"""
    full_path = os.path.normpath(os.path.join(BASE_DIR, rel_path))
    # 安全检查：确保路径在 dataset 目录内
    if not full_path.startswith(os.path.normpath(BASE_DIR)):
        raise ValueError(f"无效的文件路径: {rel_path}")
    if not os.path.exists(full_path):
        raise FileNotFoundError(f"文件不存在: {rel_path}")

    with h5py.File(full_path, 'r') as f:
        ds_path = get_dataset_path(f)
        if ds_path is None:
            raise ValueError("文件中未找到数据张量")
        data = f[ds_path][()]
        data = np.squeeze(data)
        if data.ndim != 2:
            raise ValueError(f"数据维度不正确: {data.ndim}")

        # 取标签
        try:
            raw = f["Private/GlobalLabel"][()]
            label_obj = json.loads(raw.decode("utf-8"))
            label = label_obj.get("defectType", "unknown")
        except Exception:
            label = "unknown"

        return {
            "bscan": data.tolist(),
            "ascan": data[0].tolist(),
            "shape": list(data.shape),
            "label": label,
            "filename": os.path.basename(rel_path),
        }


def predict_single_file(file_path: str, model_name: str) -> dict:
    """
    对单个 .nde 文件进行预测。

    Args:
        file_path: .nde 文件的绝对路径
        model_name: 模型名称

    Returns:
        dict: {
            "prediction": "Dl",
            "probabilities": {class: prob, ...},
            "confidence": 0.873,
            "model_name": "...",
            "class_names": ["Dl", "Db", ...],
            "model_type": "random_forest",
        }
    """
    model, meta = load_model_for_testing(model_name)
    class_names = meta["class_names"]
    model_type = meta.get("model_type", "random_forest")

    # 读取数据
    with h5py.File(file_path, "r") as f:
        ds_path = None
        for c in ["Public/Groups/0/Datasets/0-AScanAmplitude", "0-AScanAmplitude", "AScanAmplitude"]:
            if c in f:
                ds_path = c
                break
        if ds_path is None:
            def finder(name, obj):
                if isinstance(obj, h5py.Dataset) and obj.ndim == 3:
                    raise StopIteration(name)
            try:
                f.visititems(finder)
            except StopIteration as e:
                ds_path = str(e)
        if ds_path is None:
            raise ValueError("未找到数据张量")

        data = f[ds_path][()]
        data = np.squeeze(data)
        if data.ndim != 2:
            raise ValueError(f"数据维度不正确: {data.ndim}")

        # 读取元数据（两个模型分支都可能用到）
        try:
            raw_label = f["Private/GlobalLabel"][()]
            label_obj = json.loads(raw_label.decode("utf-8"))
        except Exception:
            label_obj = {}
        try:
            raw_mat = f["Private/MaterialInfo"][()]
            material_obj = json.loads(raw_mat.decode("utf-8"))
        except Exception:
            material_obj = {}

    if model_type == "deep_cnn_lstm_transformer":
        if not DEEP_LEARNING_AVAILABLE:
            raise RuntimeError("PyTorch 未安装")
        X = np.expand_dims(_standardize_2d(data), axis=0).astype(np.float32)
        # 标准化
        mean = X.mean(axis=(1, 2), keepdims=True)
        std = X.std(axis=(1, 2), keepdims=True) + 1e-8
        X = (X - mean) / std

        device = next(model.parameters()).device
        with torch.no_grad():
            inputs = torch.from_numpy(X).float().to(device)
            outputs = model(inputs)
            probs = torch.softmax(outputs, dim=1)[0].cpu().tolist()
    else:
        # RandomForest
        signal_feats = extract_features(data)
        meta_feats = encode_metadata(label_obj, material_obj)
        feats = np.concatenate([signal_feats, meta_feats]).reshape(1, -1)

        probs_raw = model.predict_proba(feats)[0]
        # 对齐到 class_names 顺序
        idx_to_class_model = {i: c for i, c in enumerate(model.classes_)}
        probs = [0.0] * len(class_names)
        for i, c in idx_to_class_model.items():
            if i < len(probs_raw) and c in class_names:
                probs[class_names.index(c)] = float(probs_raw[i])
        pred = model.predict(feats)[0]

    # 整理结果
    idx_to_class = {i: c for i, c in enumerate(class_names)}
    pred_idx = int(np.argmax(probs))
    prediction = idx_to_class[pred_idx]
    confidence = float(probs[pred_idx])
    prob_dict = {class_names[i]: round(float(probs[i]), 4) for i in range(len(class_names))}
    top3_idx = np.argsort(probs)[-3:][::-1]
    top3 = [f"{idx_to_class[int(i)]}({probs[int(i)]:.1%})" for i in top3_idx]

    return {
        "prediction": prediction,
        "probabilities": prob_dict,
        "confidence": round(confidence, 4),
        "top3": top3,
        "model_name": model_name,
        "class_names": class_names,
        "model_type": model_type,
    }


REPORT_DIR = os.path.join(os.path.dirname(__file__), "reports")
os.makedirs(REPORT_DIR, exist_ok=True)


def parse_dispatch_doc(file_path: str) -> dict:
    """
    解析委托单 .doc 文件，提取关键字段。
    委托单为表格结构，每两行一组（中文标签行 + 英文标签行）。
    返回字段名→值的字典。
    """
    import subprocess, os, shutil, tempfile

    antiword_path = shutil.which("antiword") or shutil.which("antiword.exe")
    if not antiword_path:
        for p in [
            r"E:\Program Files\Git\mingw64\bin\antiword.exe",
            r"C:\Program Files\Git\mingw64\bin\antiword.exe",
        ]:
            if os.path.exists(p):
                antiword_path = p
                break
    if not antiword_path:
        return {"_error": "antiword 未安装"}

    tmp_txt = tempfile.NamedTemporaryFile(delete=False, suffix='.txt')
    tmp_txt.close()
    subprocess.run(f'"{antiword_path}" -m UTF-8 "{file_path}" > "{tmp_txt.name}"',
                   shell=True)
    with open(tmp_txt.name, 'r', encoding='utf-8') as f:
        text = f.read()
    os.unlink(tmp_txt.name)

    # 中文字段标签 → 字段名映射
    LABEL_MAP = {
        "委托单位": "Customer_Addr",
        "委托日期": "fill_in_date",
        "零件名称": "Part_name",
        "材料牌号": "Material_type",
        "课题或生产令号": "Project_No",
        "委托检测方法": "Required_method",
        "检测区域": "Testing_area",
        "备注": "Remark",
        "项目负责人": "Project_leader",
        "要求完成日期": "Required_date",
        "数量": "Quantity",
        "制件状态": "Part_status",
        "检测方法": "Method_Spec",
        "验收标准": "Standard_level",
        "图号": "Drawing_No",
        "质量编号": "S_N",
    }

    table_lines = [l.strip() for l in text.split('\n') if l.strip().startswith('|')]
    fields = {}

    # 从文档头提取任务编号（Task No.）
    import re as _re
    task_match = _re.search(r'Task No\.\s*[:：]\s*(\S+)', text)
    if task_match:
        fields["_Task_No"] = task_match.group(1)

    for row in table_lines:
        cells = [c.strip() for c in row.split('|')]
        cells = [c for c in cells if c]
        for ci, cell in enumerate(cells):
            for label, fname in LABEL_MAP.items():
                if label in cell and fname not in fields:
                    if ci + 1 < len(cells):
                        val = cells[ci + 1]
                        # 跳过英文行（含英文关键词）、方框符号、占位符
                        skip_words = ["Customer", "Project", "Required", "Part", "Quantity",
                                      "Material", "S/N", "Method", "Specification", "Remark",
                                      "Date", "Drawing", "status", "fill", "sheet", "level",
                                      "area", "Testing", "Convention", "Porosity",
                                      "Thickness", "Other"]
                        if val and val not in ['□', '□'] and not val.startswith('#'):
                            is_eng = any(kw in val for kw in skip_words)
                            if not is_eng:
                                v = val.rstrip('□').strip()
                                if v and v != '/':
                                    fields[fname] = v

    # 跨行拼接：检查"中国航空制造技术研究"+"院"这种情况
    for i, row in enumerate(table_lines):
        cells = [c.strip() for c in row.split('|')]
        cells = [c for c in cells if c]
        # 如果这行是英文行，看上一个中文行的对应位置是否缺字
        if "Customer" in row or "sheet" in row:
            for ci, cell in enumerate(cells):
                if ci > 0 and ci < len(cells) and len(cell) > 0 and len(cell) < 6 and not any(
                    kw in cell for kw in ["Customer", "/", "□", "Project", "Required", "fill",
                                          "leader", "Teleph", "Contractor", "Date", "Agreed",
                                          "Part", "Quantity", "Drawing", "Material", "status",
                                          "S/N", "Method", "Specification", "level", "Remark"]):
                    # 可能是续行，检查上一行同位置的值是否已在 fields 中
                    if i > 0:
                        prev = [c.strip() for c in table_lines[i-1].split('|') if c.strip()]
                        if ci < len(prev):
                            for fname in list(fields.keys()):
                                # 如果上一行的对应单元格是这个字段的值
                                if prev[ci] == fields[fname]:
                                    fields[fname] = fields[fname] + cell
                                    break

    return fields


def generate_inspection_report(
    filename: str,
    meta: dict,
    signal_analysis: str,
    defect_result: str,
    confidence: float,
    model_name: str = "",
    dispatch_data: dict = None,
) -> str:
    """
    使用超声检测报告模板 (.docx) 生成检测报告。
    模板位于项目根目录的 超声检测报告.docx，含 {$...} 占位符。
    dispatch_data 为委托单解析数据，用于填充报告字段。
    返回 (报告文件路径, 报告编号)。
    """
    import shutil, re, copy
    from docx import Document
    from lxml import etree

    report_id = f"JC-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    basename = os.path.splitext(os.path.basename(filename))[0]

    # ── 1. 定位模板文件 ──
    template_path = os.path.join(os.path.dirname(__file__), "..", "超声检测报告.docx")
    if not os.path.exists(template_path):
        # 若模板不存在，回退到程序化生成
        return _generate_report_fallback(filename, meta, signal_analysis, defect_result, confidence, model_name)

    # ── 2. 复制模板 ──
    report_path = os.path.join(REPORT_DIR, f"{report_id}.docx")
    shutil.copy2(template_path, report_path)

    # ── 3. 在 XML 层合并 runs 并替换占位符 ──
    doc = Document(report_path)
    ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    NSMAP = {'w': ns}

    # 构建替换映射
    fiber_zh = {"CF":"碳纤维","GF":"玻璃纤维","BF":"硼纤维","AF":"芳纶纤维","C/SiC":"碳/碳化硅"}
    matrix_zh = {"EP":"环氧","BMI":"双马","PI":"聚酰亚胺","TP":"热塑","SiC":"碳化硅"}
    fg = meta.get("fiberGrade", meta.get("fiber", ""))
    mg = meta.get("matrixGrade", meta.get("matrix", ""))
    material_str = f"{fg}/{mg}" if fg and mg else f"{meta.get('fiber','-')}/{meta.get('matrix','-')}"

    # 信号分析摘要（取前 5 行关键信息）
    signal_lines = [l.strip() for l in signal_analysis.strip().split('\n') if l.strip()]
    signal_summary = '\n'.join(signal_lines[:8]) if signal_lines else '信号分析未完成'

    # 结论
    if defect_result and defect_result != 'OK':
        conclusion = f"缺陷类型：{defect_result}（置信度 {confidence:.1f}%）" if confidence > 0 else f"缺陷类型：{defect_result}"
        result_detail = signal_summary
    else:
        conclusion = "未检测到明显缺陷信号，判定为正常区域（OK）"
        result_detail = signal_summary

    dd = dispatch_data or {}
    def _dd(k, fallback=""):
        return dd.get(k) or fallback

    # 任务编号优先用委托单头部的 Task No.
    task_no = _dd('_Task_No', '')
    if not task_no or any(c in task_no for c in '/\\|<>:"'):
        task_no = f"JC-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    # 清理 report_id：只保留字母数字和 -_
    import re as _re
    safe_id = _re.sub(r'[^a-zA-Z0-9\-_]', '-', f"{task_no}-01")
    report_id = safe_id.strip('-')
    if not report_id:
        report_id = f"JC-{datetime.now().strftime('%Y%m%d-%H%M%S')}"

    # 委托单位名称（从 Customer_Addr 取）
    cust_name = _dd('Customer_Addr', basename.split('_')[0] if '_' in basename else basename)

    # 检测方法映射
    method_map = {"UT": "超声反射法", "超声": "超声反射法"}
    req_method = _dd('Required_method', '')
    test_method = "超声反射法"
    for k, v in method_map.items():
        if k in req_method:
            test_method = v
            break

    # 验收标准加"按"前缀
    std_level = _dd('Standard_level', 'HB 7224-2020 C级')
    if std_level and not std_level.startswith('按'):
        std_level = '按' + std_level

    replacements = {
        '{$报告编号}': report_id,
        '$VALUE0': cust_name,
        '{$Task_No}': task_no,
        '{$Receipt_date}': _dd('fill_in_date', datetime.now().strftime('%Y-%m-%d')),
        '{$Customer_address}': '北京市顺义区双河大街航空产业园',
        '{$Part_name}': _dd('Part_name', basename),
        '{$材料牌号}': _dd('Material_type', material_str),
        '{$零件状态}': _dd('Part_status', '待检'),
        '{$图号}': _dd('Drawing_No', meta.get('drawing', '-')),
        '{$零件编号}': _dd('S_N', basename),
        '{$数量}': _dd('Quantity', '1'),
        '{$检测地点}': '北京市顺义区双河大街航空产业园',
        '{$仪器型号编号}': '700M/Z07161',
        '{$探头型号编号}': 'FJ-1/Z105007',
        '{$检测方法规范}': _dd('Method_Spec', '超声脉冲反射法'),
        '{$验收标准等级}': std_level,
        '{$检测部位}': _dd('Testing_area', '按文件标注'),
        '{$委托检测方法}': test_method,
        '{$检测结果}': result_detail,
        '{$结论}': conclusion,
    }

    # 读原始 ZIP
    import zipfile, io
    with zipfile.ZipFile(report_path, 'r') as zin:
        doc_xml = zin.read('word/document.xml')

    root = etree.fromstring(doc_xml)

    # 遍历所有段落，合并相邻 run 中的文本
    for body_elem in root.iter(f'{{{ns}}}body'):
        for paragraph in body_elem.iter(f'{{{ns}}}p'):
            runs = list(paragraph.iter(f'{{{ns}}}r'))
            if not runs:
                continue

            # 找出当前段落所有 w:t 元素
            t_elements = list(paragraph.iter(f'{{{ns}}}t'))
            if not t_elements:
                continue

            # 合并所有 t 文本到一个字符串
            combined = ''.join(t.text or '' for t in t_elements)
            if not combined.strip():
                continue

            # 执行替换
            new_text = combined
            for key, val in replacements.items():
                if key in new_text:
                    new_text = new_text.replace(key, str(val))

            if new_text == combined:
                continue

            # 把新文本写回第一个 t，清空其余 t
            # 但需要保留各 t 的样式格式，所以对每个 t 尽量保持
            # 简化：只改第一个运行，清空后续
            t_elements[0].text = new_text
            for t in t_elements[1:]:
                t.text = ''
                # 保留 t 元素本身，但设为空

    # 写回 ZIP
    new_doc_xml = etree.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)

    import io as _io
    buf = _io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zout:
        with zipfile.ZipFile(report_path, 'r') as zin:
            for item in zin.infolist():
                if item.filename == 'word/document.xml':
                    zout.writestr(item, new_doc_xml)
                else:
                    zout.writestr(item, zin.read(item.filename))

    with open(report_path, 'wb') as f:
        f.write(buf.getvalue())

    return report_path, report_id


def _generate_report_fallback(
    filename: str,
    meta: dict,
    signal_analysis: str,
    defect_result: str,
    confidence: float,
    model_name: str = "",
) -> str:
    """
    回退方案：程序化生成 Word 报告（当模板不存在时使用）
    """
    from docx import Document
    from docx.shared import Pt, Inches, Cm, RGBColor
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.enum.table import WD_TABLE_ALIGNMENT

    report_id = f"JC-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    basename = os.path.splitext(os.path.basename(filename))[0]

    doc = Document()

    # ── 全局样式 ──
    style = doc.styles['Normal']
    style.font.name = '宋体'
    style.font.size = Pt(11)
    style.paragraph_format.line_spacing = 1.5

    # ═══ 标题 ═══
    title = doc.add_heading('复合材料超声检测分析报告', level=0)
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    for run in title.runs:
        run.font.color.rgb = RGBColor(0, 0, 0)

    # ═══ 报告信息 ═══
    doc.add_paragraph('')
    info_table = doc.add_table(rows=4, cols=4)
    info_table.style = 'Table Grid'
    info_table.alignment = WD_TABLE_ALIGNMENT.CENTER

    info_data = [
        ['报告编号', report_id, '检测日期', datetime.now().strftime('%Y-%m-%d')],
        ['文件名称', basename, '检测方法', meta.get('method', '-')],
        ['纤维类型', meta.get('fiber', '-'), '基体类型', meta.get('matrix', '-')],
        ['结构类型', meta.get('structure', '-'), '评估模型', model_name],
    ]
    for i, row_data in enumerate(info_data):
        for j, val in enumerate(row_data):
            cell = info_table.cell(i, j)
            cell.text = val
            for paragraph in cell.paragraphs:
                paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
                for run in paragraph.runs:
                    run.font.size = Pt(10)
                    if j % 2 == 0:
                        run.font.bold = True

    doc.add_paragraph('')

    # ═══ 信号分析 ═══
    doc.add_heading('一、信号分析结果', level=1)
    for line in signal_analysis.strip().split('\n'):
        line = line.strip()
        if not line:
            continue
        if line.startswith('- '):
            p = doc.add_paragraph(line[2:], style='List Bullet')
        elif line.startswith('**') and line.endswith('**'):
            p = doc.add_paragraph(line.strip('*'))
            for run in p.runs:
                run.font.bold = True
                run.font.size = Pt(11)
        else:
            doc.add_paragraph(line)

    # ═══ 检测结论 ═══
    doc.add_heading('二、检测结论', level=1)
    conclusion_p = doc.add_paragraph()
    if defect_result:
        run = conclusion_p.add_run(f'缺陷类型：{defect_result}')
        run.font.bold = True
        run.font.size = Pt(12)
        if confidence > 0:
            doc.add_paragraph(f'置信度：{confidence:.1f}%')
        else:
            doc.add_paragraph('置信度：参考分析文本（AI 生成结论）')
    else:
        conclusion_p.add_run('未检测到明显缺陷信号，判定为正常区域（OK）。')

    # ═══ 建议 ═══
    doc.add_heading('三、建议', level=1)
    if defect_result and defect_result != 'OK':
        doc.add_paragraph('1. 建议对该区域进行补充扫描，确认缺陷范围。')
        doc.add_paragraph('2. 建议结合其它无损检测方法进行交叉验证。')
        doc.add_paragraph('3. 如确认缺陷，建议评估其对结构完整性的影响。')
    else:
        doc.add_paragraph('1. 当前检测点信号正常，未发现明显异常。')
        doc.add_paragraph('2. 建议按计划继续进行后续检测。')

    doc.add_paragraph('')
    doc.add_paragraph('声明：本报告由复合材料智能评估系统自动生成，仅供技术参考。').alignment = WD_ALIGN_PARAGRAPH.CENTER

    report_path = os.path.join(REPORT_DIR, f"{report_id}.docx")
    doc.save(report_path)
    return report_path, report_id
