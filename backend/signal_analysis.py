"""
信号分析模块
从 .nde 文件中提取信号特征，用于 DeepSeek API 的上下文构建
"""
import os
import json
import h5py
import numpy as np


def _get_dataset_path(f: h5py.File) -> str:
    """在 HDF5 文件中查找主数据张量的路径"""
    candidates = [
        "Public/Groups/0/Datasets/0-AScanAmplitude",
        "0-AScanAmplitude",
        "AScanAmplitude",
    ]
    for c in candidates:
        if c in f:
            return c
    # 遍历查找第一个 3D dataset
    def finder(name, obj):
        if isinstance(obj, h5py.Dataset) and obj.ndim == 3:
            raise StopIteration(name)
    try:
        f.visititems(finder)
    except StopIteration as e:
        return str(e)
    return None


def load_nde_meta(file_path: str) -> dict:
    """
    读取 .nde 文件的元数据（GlobalLabel + MaterialInfo + DetectionInfo）
    """
    meta = {}
    try:
        with h5py.File(file_path, "r") as f:
            # GlobalLabel
            try:
                raw = f["Private/GlobalLabel"][()]
                meta["GlobalLabel"] = json.loads(raw.decode("utf-8"))
            except Exception:
                pass
            # MaterialInfo
            try:
                raw = f["Private/MaterialInfo"][()]
                meta["MaterialInfo"] = json.loads(raw.decode("utf-8"))
            except Exception:
                pass
            # DetectionInfo
            try:
                raw = f["Private/DetectionInfo"][()]
                meta["DetectionInfo"] = json.loads(raw.decode("utf-8"))
            except Exception:
                pass
    except Exception:
        pass
    return meta


def load_nde_signal(file_path: str) -> np.ndarray:
    """
    读取 .nde 文件的 B-scan 信号数据。
    返回 [N, 2000] numpy 数组。
    """
    with h5py.File(file_path, "r") as f:
        ds_path = _get_dataset_path(f)
        if ds_path is None:
            raise ValueError("未找到数据张量")
        data = f[ds_path][()]
        data = np.squeeze(data)
        if data.ndim != 2:
            raise ValueError(f"数据维度不正确: {data.ndim}")
        return data


def analyze_signal(file_path: str) -> dict:
    """
    对 .nde 文件进行全面信号分析，返回结构化特征。

    Returns:
        dict: {
            "amp_range": [min, max],
            "energy": float,
            "snr_db": float,
            "attenuation": float,
            "backwall_ratio": float,
            "mean_amplitude": float,
            "std_amplitude": float,
            "peak_location": int,
            "has_abnormal_zone": bool,
            "abnormal_zone_desc": str,
            "n_rows": int,
            "n_cols": int,
        }
    """
    data = load_nde_signal(file_path)
    n_rows, n_cols = data.shape

    # 全信号统计
    all_vals = data.flatten()
    amp_min = float(np.min(all_vals))
    amp_max = float(np.max(all_vals))
    amp_mean = float(np.mean(all_vals))
    amp_std = float(np.std(all_vals))

    # 信号能量（总能量 = 幅值平方和）
    energy = float(np.sum(all_vals ** 2))

    # 信噪比估算（信号为整体，噪声取信号后半段无回波区域的后 10%）
    noise_region = data[:, -200:] if n_cols > 200 else data[:, -50:]
    noise_std = float(np.std(noise_region.flatten())) + 1e-10
    snr_db = float(20 * np.log10(amp_std / noise_std)) if noise_std > 0 else 0

    # 各行 A-scan 的峰值位置（回波到达时间）
    peak_positions = []
    for i in range(n_rows):
        row = data[i, :]
        # 平滑后找峰值（跳过前 10 个采样点避免初始脉冲干扰）
        peak_idx = np.argmax(np.abs(row[10:])) + 10
        peak_positions.append(peak_idx)
    avg_peak_pos = float(np.mean(peak_positions))

    # 底波分析：取每行 A-scan 后半段的能量（底波区域）
    half = n_cols // 2
    front_energy = np.sum(data[:, :half] ** 2)
    back_energy = np.sum(data[:, half:] ** 2)
    backwall_ratio = float(back_energy / (front_energy + 1e-10))

    # 异常区域检测：滑动窗口能量比
    window_size = max(16, n_cols // 32)
    n_windows = n_cols - window_size
    window_energies = np.array([
        np.sum(data[:, i:i + window_size] ** 2)
        for i in range(0, n_windows, window_size // 2)
    ])
    mean_we = np.mean(window_energies)
    std_we = np.std(window_energies)
    abnormal_zones = np.where(window_energies > mean_we + 2 * std_we)[0]

    step = window_size // 2
    if len(abnormal_zones) > 0:
        has_abnormal = True
        # 构建结构化异常区域列表
        abnormal_zone_positions = []
        seen_zones = set()
        for az in abnormal_zones:
            pos = int(az * step)
            # 去重（相邻窗口可能检测到同一个区域）
            key = (pos // step) * step
            if key in seen_zones:
                continue
            seen_zones.add(key)
            ratio = float(window_energies[az] / (mean_we + 1e-10))
            abnormal_zone_positions.append({
                "start": pos,
                "end": min(pos + window_size, n_cols),
                "center": pos + window_size // 2,
                "desc": "异常高能区域",
            })
        abnormal_desc = abnormal_zone_positions[0]["desc"]
    else:
        has_abnormal = False
        abnormal_desc = "未检测到明显异常区域"
        abnormal_zone_positions = []

    # 衰减系数估算：首行 vs 末行能量比
    if n_rows > 1:
        first_row_energy = float(np.sum(data[0, :] ** 2))
        last_row_energy = float(np.sum(data[-1, :] ** 2)) + 1e-10
        attenuation = float(first_row_energy / last_row_energy)
    else:
        attenuation = 1.0

    return {
        "amp_range": [round(amp_min, 2), round(amp_max, 2)],
        "energy": round(energy, 2),
        "snr_db": round(snr_db, 2),
        "mean_amplitude": round(amp_mean, 4),
        "std_amplitude": round(amp_std, 4),
        "peak_location": round(avg_peak_pos, 1),
        "backwall_ratio": round(backwall_ratio, 4),
        "attenuation": round(attenuation, 4),
        "has_abnormal_zone": has_abnormal,
        "abnormal_zone_desc": abnormal_desc,
        "abnormal_zone_positions": abnormal_zone_positions,
        "n_rows": n_rows,
        "n_cols": n_cols,
    }


def analyze_waveform_per_frame(file_path: str) -> dict:
    """
    逐帧分析 A-Scan 波形，返回全量数据和每帧的异常标记。

    Returns:
        dict: {
            "bscan": [[...], ...],          # 全量 [N, 2000]
            "n_frames": N,
            "frame_energy": [float, ...],    # 每帧能量
            "abnormal_frames": [int, ...],   # 异常帧索引列表
            "abnormal_indices": [int, ...],  # 同 abnormal_frames
            "frame_stats": [{peak, mean, std, energy}, ...],
        }
    """
    data = load_nde_signal(file_path)
    n_frames = data.shape[0]
    frame_energy = []
    abnormal_frames = []
    frame_stats = []

    # 每帧能量 = sum(|信号|^2)，能量低=衰减(可能缺陷)，能量高=强反射(也可能缺陷)
    all_energy = np.sum(data ** 2, axis=1)
    median_energy = np.median(all_energy)
    # 用四分位距(IQR)作为离散度指标，比标准差更抗异常值干扰
    q1 = np.percentile(all_energy, 25)
    q3 = np.percentile(all_energy, 75)
    iqr = q3 - q1

    # 异常判定：能量低于 Q1-1.5*IQR（显著衰减）或高于 Q3+1.5*IQR（显著增强）
    low_threshold = q1 - 1.5 * iqr
    high_threshold = q3 + 1.5 * iqr

    for i in range(n_frames):
        row = data[i, :]
        energy = float(np.sum(row ** 2))
        peak = float(np.max(np.abs(row)))
        mean = float(np.mean(row))
        std = float(np.std(row))
        frame_energy.append(round(energy, 2))
        frame_stats.append({
            "peak": round(peak, 2),
            "mean": round(mean, 4),
            "std": round(std, 4),
            "energy": round(energy, 2),
        })
        if energy < low_threshold or energy > high_threshold:
            abnormal_frames.append(i)

    return {
        "bscan": data.tolist(),
        "n_frames": n_frames,
        "frame_energy": frame_energy,
        "abnormal_frames": abnormal_frames,
        "abnormal_indices": abnormal_frames,
        "frame_stats": frame_stats,
    }


def detect_surface_and_backwall(ascan: np.ndarray) -> dict:
    """
    从单帧 A-Scan 波形中识别界波（表面波）和底波（底面回波）。

    逻辑：
    1. 界波 = 整段信号中幅值最大的波峰（表面反射通常最强）
    2. 底波 = 界波之后，信号最后一段中的最大波峰
    """
    n = len(ascan)
    abs_signal = np.abs(ascan)

    # 界波：跳过前 1% 电噪声，找全局最大幅值
    search_start = int(n * 0.01)
    global_max_idx = int(np.argmax(abs_signal[search_start:])) + search_start
    surface_peak = global_max_idx
    surface_amp = float(ascan[surface_peak])

    # 底波：从界波之后偏移 15%（避开界波波包）到末尾 3%（避开尾部噪声）
    bw_start = min(surface_peak + int(n * 0.15), int(n * 0.85))
    bw_end = int(n * 0.97)
    bw_seg = abs_signal[bw_start:bw_end]
    if len(bw_seg) == 0:
        backwall_peak = bw_start
        backwall_amp = 0
    else:
        local_max = int(np.argmax(bw_seg))
        backwall_peak = bw_start + local_max
        backwall_amp = float(ascan[backwall_peak])

    return {
        "surface_peak": int(surface_peak),
        "surface_amplitude": round(surface_amp, 2),
        "backwall_peak": int(backwall_peak),
        "backwall_amplitude": round(backwall_amp, 2),
    }


def analyze_waveform_keypoints(file_path: str) -> dict:
    """对 .nde 文件所有帧识别界波和底波位置"""
    data = load_nde_signal(file_path)
    n_frames = data.shape[0]
    keypoints = [detect_surface_and_backwall(data[i, :]) for i in range(n_frames)]
    return {
        "bscan": data.tolist(),
        "n_frames": n_frames,
        "keypoints": keypoints,
    }
