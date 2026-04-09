import { useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import * as turf from '@turf/turf';
import 'mapbox-gl/dist/mapbox-gl.css';
import '../App.css';

// 与 EditorPage 保持一致的 Mapbox token
mapboxgl.accessToken = 'pk.eyJ1IjoieWNzb2t1IiwiYSI6ImNrenozdWdodDAza3EzY3BtdHh4cm5pangifQ.ZigfygDi2bK4HXY1pWh-wg';

// 后端返回的任务结构
interface Task {
  id: number;
  task_id: string;
  task_name: string;
  bank_ids: string[];
  description: string;
  created_at: string;
  status?: string;
  run_started_at?: string | null;
  run_completed_at?: string | null;
  error_message?: string | null;
}

// 断面结构（带模型结果）
interface SectionResult {
  section_id: string;
  id?: number;
  section_name?: string;
  distance: number;
  bank_id: string;
  geometry: any;
  risk_level?: string | number; // 字符串(high, medium, low, no) 或 数字(1, 2, 3, 4)
  risk_score?: number;
}

type TaskProgressSnapshot = {
  taskId: string;
  taskName?: string;
  status?: string;
  runStartedAt?: string | null;
  runCompletedAt?: string | null;
  expectedTotal: number;
  processedCount: number;
  successCount: number;
  errorCount: number;
  lastUpdatedAt: string;
  errors: Array<{
    section_id: string;
    section_name?: string;
    bank_id?: string;
    message: string;
    raw?: any;
    detail?: any;
    detailError?: string;
  }>;
};

// 颜色映射：支持数字 ID 和 字符串
// 风险等级映射：0 最低，3 最高
const RISK_COLORS: Record<string, string> = {
  '0': '#10b981', // 最低风险 - 绿
  '1': '#facc15', // 低-中 - 黄
  '2': '#f97316', // 较高 - 橙
  '3': '#ef4444', // 最高 - 红
  'default': '#94a3b8'
};

function ResultPage() {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  const pollTimerRef = useRef<number | null>(null);
  const activePollTaskIdRef = useRef<string | null>(null);
  const lastSectionsByTaskRef = useRef<Record<string, SectionResult[]>>({});

  const sectionClickHandlerRef = useRef<((e: any) => void) | null>(null);
  const sectionEnterHandlerRef = useRef<(() => void) | null>(null);
  const sectionLeaveHandlerRef = useRef<(() => void) | null>(null);

  const [taskList, setTaskList] = useState<Task[]>([]);
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSections, setShowSections] = useState(true);

  const [progressOpen, setProgressOpen] = useState(false);
  const [progress, setProgress] = useState<TaskProgressSnapshot | null>(null);
  const [expandedErrorIds, setExpandedErrorIds] = useState<Record<string, boolean>>({});

  // 切换断面可见性
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;
    
    if (map.getLayer('sections-line')) {
      map.setLayoutProperty('sections-line', 'visibility', showSections ? 'visible' : 'none');
    }
    if (map.getLayer('sections-line-hit')) {
      map.setLayoutProperty('sections-line-hit', 'visibility', showSections ? 'visible' : 'none');
    }
  }, [showSections]);

  const stopPolling = () => {
    if (pollTimerRef.current) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    activePollTaskIdRef.current = null;
  };

  useEffect(() => {
    return () => {
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 风险解析辅助：判断 risk_level 是否为 0-3 的有效数字
  const getRiskInfo = (risk: any) => {
    if (risk === null || risk === undefined) {
      return { valid: false, color: RISK_COLORS.default, label: '未知', level: null };
    }

    const n = Number(risk);
    if (!isNaN(n) && Number.isFinite(n) && n >= 0 && n <= 3) {
      return { valid: true, color: RISK_COLORS[String(n)] || RISK_COLORS.default, label: n, level: n };
    }

    // 非 0-3 的值视为未知（灰色）
    return { valid: false, color: RISK_COLORS.default, label: '未知', level: null };
  };

  // 获取所有任务列表
  useEffect(() => {
    const fetchTasks = async () => {
      try {
        const res = await fetch('/v0/bank/tasks');
        if (!res.ok) throw new Error('获取任务列表失败');
        const data = await res.json();
        if (data.success) {
          setTaskList(data.tasks || []);
        }
      } catch (err: any) {
        console.error('获取任务列表失败:', err);
        setError('无法加载任务列表');
      }
    };
    fetchTasks();
  }, []);

  const parseResultsList = (data: any): any[] => {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.results)) return data.results;
    if (Array.isArray(data.data)) return data.data;
    if (Array.isArray(data.items)) return data.items;
    return [];
  };

  const normalizeResultRecord = (r: any) => {
    const sectionId = r?.section_id ?? r?.sectionId ?? r?.sectionID;
    const riskLevel = r?.risk_level ?? r?.riskLevel ?? r?.risk;
    const status = r?.status ?? r?.state ?? r?.code;
    const message = r?.error_message ?? r?.errorMessage ?? r?.error ?? r?.message;
    return { sectionId, riskLevel, status, message, raw: r };
  };

  const isTaskCompleted = (taskInfo: any) => {
    const st = String(taskInfo?.status ?? '').toLowerCase();
    if (st === 'completed' || st === 'success' || st === 'done') return true;
    if (taskInfo?.run_completed_at) return true;
    if (taskInfo?.runCompletedAt) return true;
    return false;
  };

  const loadErrorDetail = async (taskId: string, sectionId: string) => {
    // 仅在当前任务仍为选中时才更新
    if (!taskId || taskId !== selectedTask) return;

    try {
      const res = await fetch(`/v0/bank/results/${sectionId}`);
      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }

      setProgress(prev => {
        if (!prev || prev.taskId !== taskId) return prev;
        const nextErrors = prev.errors.map(e => {
          if (e.section_id !== sectionId) return e;
          if (!res.ok) {
            return { ...e, detailError: `HTTP ${res.status}: ${text?.slice(0, 500)}` };
          }
          return { ...e, detail: json ?? text };
        });
        return { ...prev, errors: nextErrors };
      });
    } catch (err: any) {
      setProgress(prev => {
        if (!prev || prev.taskId !== taskId) return prev;
        const nextErrors = prev.errors.map(e => {
          if (e.section_id !== sectionId) return e;
          return { ...e, detailError: err?.message || '获取错误详情失败' };
        });
        return { ...prev, errors: nextErrors };
      });
    }
  };

  const updateProgressAndMap = async (taskId: string, taskName: string | undefined, baseSections: SectionResult[]) => {
    const startedAt = new Date().toISOString();
    const map = mapRef.current;

    let taskInfo: any = null;
    let resultsList: any[] = [];

    try {
      const taskRes = await fetch(`/v0/bank/tasks/${taskId}`);
      if (taskRes.ok) {
        const jt = await taskRes.json().catch(() => null);
        taskInfo = jt?.task ?? jt?.data ?? jt;
      }
    } catch (err) {
      // 忽略：任务状态接口可能不可用，但轮询结果仍可继续
    }

    // 兼容：部分后端只在 /full 中返回 status/run_completed_at 等字段
    if (!taskInfo || (!taskInfo.status && !taskInfo.run_completed_at && !taskInfo.runCompletedAt)) {
      try {
        const fullRes = await fetch(`/v0/bank/tasks/${taskId}/full`);
        if (fullRes.ok) {
          const jf = await fullRes.json().catch(() => null);
          const d = jf?.data ?? jf;
          taskInfo = d?.task ?? d?.data?.task ?? taskInfo;
        }
      } catch {
        // ignore
      }
    }

    try {
      const resultsRes = await fetch(`/v0/bank/results?task_id=${encodeURIComponent(taskId)}`);
      if (resultsRes.ok) {
        const jr = await resultsRes.json().catch(() => null);
        resultsList = parseResultsList(jr);
      }
    } catch (err) {
      // 忽略：临时网络错误不应中断轮询
    }

    if (activePollTaskIdRef.current !== taskId) return;

    const latestBySection: Record<string, ReturnType<typeof normalizeResultRecord>> = {};
    resultsList.forEach(r => {
      const nr = normalizeResultRecord(r);
      if (!nr.sectionId) return;
      latestBySection[String(nr.sectionId)] = nr;
    });

    const resultBySection: Record<string, { riskLevel?: any; status?: any; message?: any; raw?: any }> = {};
    const errorsFromResults: TaskProgressSnapshot['errors'] = [];
    Object.keys(latestBySection).forEach(sectionId => {
      const nr = latestBySection[sectionId];
      resultBySection[sectionId] = {
        riskLevel: nr.riskLevel,
        status: nr.status,
        message: nr.message,
        raw: nr.raw
      };

      const st = String(nr.status ?? '').toUpperCase();
      const hasError = (nr.message && String(nr.message).trim().length > 0) || (st && st !== 'SUCCESS' && st !== 'COMPLETED' && st !== '200');
      const riskIsValidNumber = (() => {
        const n = Number(nr.riskLevel);
        return !isNaN(n) && Number.isFinite(n) && n >= 0 && n <= 3;
      })();

      if (hasError && !riskIsValidNumber) {
        errorsFromResults.push({
          section_id: String(sectionId),
          message: String(nr.message ?? nr.status ?? '未知错误'),
          raw: nr.raw
        });
      }
    });

    const mergedSections = baseSections.map(s => {
      const hit = resultBySection[s.section_id];
      if (!hit) return s;
      return { ...s, risk_level: hit.riskLevel ?? s.risk_level };
    });

    // 统计成功数：以 risk_level(0-3) 为准
    const successCount = mergedSections.reduce((acc, s) => {
      const n = Number(s.risk_level);
      if (!isNaN(n) && Number.isFinite(n) && n >= 0 && n <= 3) return acc + 1;
      return acc;
    }, 0);

    // 如果任务已完成，但仍有部分断面没有结果，则把它们当作“无结果/计算失败”展示出来
    const completed = isTaskCompleted(taskInfo);
    const missingAsErrors: TaskProgressSnapshot['errors'] = [];
    if (completed) {
      mergedSections.forEach(s => {
        const hasAnyResult = Boolean(resultBySection[s.section_id]);
        const n = Number(s.risk_level);
        const riskOk = !isNaN(n) && Number.isFinite(n) && n >= 0 && n <= 3;
        if (!hasAnyResult || !riskOk) {
          const already = errorsFromResults.some(e => e.section_id === s.section_id);
          if (!already) {
            missingAsErrors.push({
              section_id: s.section_id,
              section_name: s.section_name,
              bank_id: s.bank_id,
              message: hasAnyResult ? '计算未返回有效风险等级' : '未返回结果（可能计算失败）'
            });
          }
        }
      });
    }

    const allErrors = [...errorsFromResults, ...missingAsErrors].map(e => {
      const sec = baseSections.find(s => s.section_id === e.section_id);
      return {
        ...e,
        section_name: e.section_name ?? sec?.section_name,
        bank_id: e.bank_id ?? sec?.bank_id
      };
    });

    const expectedTotal = baseSections.length;
    const processedCount = completed ? expectedTotal : Math.min(expectedTotal, successCount + allErrors.length);

    setProgress({
      taskId,
      taskName,
      status: taskInfo?.status,
      runStartedAt: taskInfo?.run_started_at ?? taskInfo?.runStartedAt ?? null,
      runCompletedAt: taskInfo?.run_completed_at ?? taskInfo?.runCompletedAt ?? null,
      expectedTotal,
      processedCount,
      successCount,
      errorCount: allErrors.length,
      lastUpdatedAt: startedAt,
      errors: allErrors
    });

    // 轮询驱动地图刷新（断面颜色 + 岸段插值）
    if (map) {
      renderSections(mergedSections);
      applyShorelineGradient(mergedSections);
    }

    const shouldStop = completed || (expectedTotal > 0 && processedCount >= expectedTotal);
    if (shouldStop) {
      stopPolling();
    }
  };

  // 点击任务：获取任务详情（包含所有断面及其结果）并在地图可视化
  const handleTaskClick = async (taskId: string) => {
    stopPolling();

    setSelectedTask(taskId);
    setLoading(true);
    setError(null);
    setProgressOpen(true);
    setProgress(null);
    setExpandedErrorIds({});

    // 清除地图上所有之前任务的图层和数据源
    const map = mapRef.current;
    if (map) {
      // 清除断面图层
      ['sections-line-hit', 'sections-line'].forEach(layer => {
        if (map.getLayer(layer)) map.removeLayer(layer);
      });
      if (map.getSource('sections-source')) map.removeSource('sections-source');

      // 清除所有中线图层（以 midline- 开头的）
      const style = map.getStyle();
      if (style && style.layers) {
        style.layers.forEach((layer: any) => {
          if (layer.id && layer.id.startsWith('midline-')) {
            if (map.getLayer(layer.id)) map.removeLayer(layer.id);
          }
        });
      }
      
      // 清除所有中线数据源（以 midline- 开头的）
      if (style && style.sources) {
        Object.keys(style.sources).forEach((sourceId: string) => {
          if (sourceId.startsWith('midline-')) {
            if (map.getSource(sourceId)) map.removeSource(sourceId);
          }
        });
      }
    }

    try {
      // 1) 先拉取断面列表（含几何），先渲染“未着色”的断面
      const sectionsRes = await fetch(`/v0/bank/sections?task_id=${encodeURIComponent(taskId)}`);
      if (!sectionsRes.ok) throw new Error('获取断面列表失败');
      const js = await sectionsRes.json().catch(() => null);
      const sectionsRaw: any[] = (js?.sections ?? js?.data ?? js) || [];
      const sectionResults: SectionResult[] = (Array.isArray(sectionsRaw) ? sectionsRaw : [])
        .filter(s => s && (s.geometry || s.section_geometry))
        .map((s: any) => ({
          section_id: s.section_id,
          section_name: s.section_name,
          distance: Number(s.distance ?? 0),
          bank_id: s.bank_id ?? 'unknown',
          geometry: s.geometry ?? s.section_geometry,
          risk_level: s.risk_level
        }));

      lastSectionsByTaskRef.current[taskId] = sectionResults;

      // 2) 地图初始渲染（先灰色/未知风险），并缩放到断面范围
      renderSections(sectionResults);
      applyShorelineGradient(sectionResults);

      const map = mapRef.current;
      if (map && sectionResults.length > 0) {
        const sectionFeatures = sectionResults
          .filter(s => s.geometry)
          .map(s => ({ type: 'Feature', geometry: s.geometry, properties: {} }));
        if (sectionFeatures.length > 0) {
          const bbox = turf.bbox({ type: 'FeatureCollection', features: sectionFeatures as any });
          map.fitBounds([bbox[0], bbox[1], bbox[2], bbox[3]], { padding: 80 });
        }
      }

      // 3) 打开进度窗口并开始轮询（任务状态 + 结果列表），驱动地图插值持续更新
      activePollTaskIdRef.current = taskId;

      // 任务名用于弹窗展示（优先用列表中的名称）
      const taskName = taskList.find(t => t.task_id === taskId)?.task_name;

      // 立即执行一次，再开启定时轮询
      await updateProgressAndMap(taskId, taskName, sectionResults);

      pollTimerRef.current = window.setInterval(() => {
        if (activePollTaskIdRef.current !== taskId) return;
        const latestSections = lastSectionsByTaskRef.current[taskId] ?? sectionResults;
        updateProgressAndMap(taskId, taskName, latestSections);
      }, 2000);

    } catch (e: any) {
      console.error(e);
      setError(e.message || '加载任务数据失败');
    } finally {
      setLoading(false);
    }
  };

  // 删除当前选中的任务
  const handleDeleteTask = async () => {
    if (!selectedTask) return;

    const confirmDelete = window.confirm('确定要删除当前选中的任务吗？此操作不可恢复。');
    if (!confirmDelete) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/v0/bank/tasks/${selectedTask}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('删除任务失败');

      const data = await res.json().catch(() => ({}));
      if (data && data.success === false) {
        throw new Error(data.message || '删除任务失败');
      }

      // 从任务列表中移除已删除任务
      setTaskList(prev => prev.filter(task => task.task_id !== selectedTask));

      // 清空当前选择
      stopPolling();
      setSelectedTask(null);
      setProgressOpen(false);
      setProgress(null);

      // 清理地图上的图层和数据源
      const map = mapRef.current;
      if (map) {
        ['sections-line-hit', 'sections-line'].forEach(layer => {
          if (map.getLayer(layer)) map.removeLayer(layer);
        });
        if (map.getSource('sections-source')) map.removeSource('sections-source');

        const style = map.getStyle();
        if (style && style.layers) {
          style.layers.forEach((layer: any) => {
            if (layer.id && typeof layer.id === 'string' && layer.id.startsWith('midline-')) {
              if (map.getLayer(layer.id)) map.removeLayer(layer.id);
            }
          });
        }

        if (style && style.sources) {
          Object.keys(style.sources).forEach((sourceId: string) => {
            if (sourceId.startsWith('midline-')) {
              if (map.getSource(sourceId)) map.removeSource(sourceId);
            }
          });
        }
      }
    } catch (e: any) {
      console.error('删除任务出错:', e);
      setError(e.message || '删除任务失败');
    } finally {
      setLoading(false);
    }
  };

  // 渲染断面集合几何并在地图显示
  const renderSections = (sections: SectionResult[]) => {
    const map = mapRef.current;
    if (!map) return;

    // 转换断面数据为 GeoJSON
    const features = sections.filter(s => s.geometry).map(s => {
      const info = getRiskInfo(s.risk_level);
      const color = info.color;
      const displayRisk = info.valid ? info.level : info.label;

      // 风险等级的中文标签映射
      const RISK_LABELS: Record<number, string> = {
        3: '极高风险',
        2: '高风险',
        1: '一般风险',
        0: '低/无风险'
      };

      const riskLabel = info.valid && info.level !== null ? RISK_LABELS[info.level] : '未知';

      return {
        type: 'Feature',
        geometry: s.geometry,
        properties: {
          id: s.section_id,
          name: s.section_name || s.section_id,
          risk_level: displayRisk,
          risk_label: riskLabel,
          color: color
        }
      };
    });


    // 更新/创建 source（支持高频刷新）
    const fc = turf.featureCollection(features as any);
    const existingSource = map.getSource('sections-source') as mapboxgl.GeoJSONSource | undefined;
    if (existingSource) {
      existingSource.setData(fc as any);
    } else {
      map.addSource('sections-source', {
        type: 'geojson',
        data: fc as any
      });
    }

    // 若图层不存在则创建一次；后续仅更新 source 数据与可见性
    if (!map.getLayer('sections-line')) {
      map.addLayer({
        id: 'sections-line',
        type: 'line',
        source: 'sections-source',
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
          'visibility': showSections ? 'visible' : 'none'
        },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 8,
          'line-opacity': 0.9
        }
      });
    }

    if (!map.getLayer('sections-line-hit')) {
      map.addLayer({
        id: 'sections-line-hit',
        type: 'line',
        source: 'sections-source',
        paint: {
          'line-width': 12,
          'line-opacity': 0
        },
        layout: {
          'visibility': showSections ? 'visible' : 'none'
        }
      });
    }

    // 事件只绑定一次（防止轮询刷新导致重复绑定）
    if (!sectionClickHandlerRef.current) {
      sectionClickHandlerRef.current = (e: any) => {
        if (!e.features || e.features.length === 0) return;
        const f = e.features[0];
        const p = f.properties;
        if (!p) return;

        new mapboxgl.Popup()
          .setLngLat(e.lngLat)
          .setHTML(`
            <div style="padding: 4px; font-family: sans-serif;">
              <p style="margin:0; font-weight:bold; color:#1e293b;">${p.name}</p>
              <p style="margin:4px 0 0; font-size:12px; color:#64748b;">断面ID: ${p.id}</p>
              <p style="margin:4px 0 0; font-size:12px; color:#64748b;">风险等级:
                <span style="color:${p.color}; font-weight:bold;">${p.risk_label}</span>
              </p>
            </div>
          `)
          .addTo(map);
      };
      sectionEnterHandlerRef.current = () => {
        map.getCanvas().style.cursor = 'pointer';
      };
      sectionLeaveHandlerRef.current = () => {
        map.getCanvas().style.cursor = '';
      };

      map.off('click', 'sections-line-hit', sectionClickHandlerRef.current);
      map.on('click', 'sections-line-hit', sectionClickHandlerRef.current);

      map.off('mouseenter', 'sections-line-hit', sectionEnterHandlerRef.current);
      map.on('mouseenter', 'sections-line-hit', sectionEnterHandlerRef.current);

      map.off('mouseleave', 'sections-line-hit', sectionLeaveHandlerRef.current);
      map.on('mouseleave', 'sections-line-hit', sectionLeaveHandlerRef.current);
    }
  };

  // 颜色插值逻辑: 基于同一岸段下所有断面中点生成一条折线，并根据中点的风险值插值颜色
  const applyShorelineGradient = (sections: SectionResult[]) => {
    const map = mapRef.current;
    if (!map || !sections || sections.length === 0) return;

    // 1. 按 bank_id 分组
    const groups: Record<string, SectionResult[]> = {};
    sections.forEach(s => {
      const bid = s.bank_id || 'unknown';
      if (!groups[bid]) groups[bid] = [];
      groups[bid].push(s);
    });

    // 2. 遍历每个岸段组
    Object.keys(groups).forEach(bankId => {
      const bankSections = groups[bankId];
      if (!bankSections || bankSections.length < 2) return;

      // 计算每个断面中点，并按传入的断面顺序（即 sections 数组本身的顺序）连接
      // 说明：此前按经纬度排序（西→东、北→南）会改变生成顺序；现在改为使用后端/生成顺序（section 列表顺序）
      const points = bankSections
        .filter(s => s && s.geometry && s.geometry.type === 'LineString')
        .map(s => {
          const coords = (s.geometry as any).coordinates as number[][];
          if (!coords || coords.length < 2) return null;
          const mid: number[] = [
            (coords[0][0] + coords[1][0]) / 2,
            (coords[0][1] + coords[1][1]) / 2
          ];
          const info = getRiskInfo(s.risk_level);
          return { mid, color: info.color, section: s };
        })
        .filter(Boolean) as Array<{ mid: number[]; color: string; section: SectionResult }>;

      if (points.length < 2) return;

      const midpoints = points.map(p => p.mid as number[]);
      const newLine = turf.lineString(midpoints as any);
      const totalDist = turf.length(newLine, { units: 'meters' });

      // 构建颜色梯度参数（沿排序后的折线累积距离）
      const riskStops: { val: number; color: string }[] = [];
      let currentDist = 0;
      for (let idx = 0; idx < points.length; idx++) {
        if (idx > 0) {
          const prevMid = points[idx - 1].mid;
          const currMid = points[idx].mid;
          currentDist += turf.distance(prevMid as any, currMid as any, { units: 'meters' });
        }
        const progress = totalDist > 0 ? (currentDist / totalDist) : 0;
        riskStops.push({ val: progress, color: points[idx].color });
      }

      // Mapbox interpolate 表达式格式
      const stops: any[] = ['interpolate', ['linear'], ['line-progress']];
      riskStops.forEach(rs => {
        const val = Math.max(0, Math.min(1, rs.val));
        stops.push(val, rs.color);
      });

      // 渲染新生成的中间折线
      const layerId = `midline-result-${bankId}`;
      const sourceId = `midline-source-${bankId}`;

      const existing = map.getSource(sourceId) as mapboxgl.GeoJSONSource | undefined;
      if (existing) {
        existing.setData(newLine as any);
      } else {
        map.addSource(sourceId, { type: 'geojson', data: newLine as any, lineMetrics: true } as any);
      }

      if (!map.getLayer(layerId)) {
        map.addLayer({
          id: layerId,
          type: 'line',
          source: sourceId,
          paint: {
            'line-width': 20,
            'line-gradient': stops as any,
            'line-opacity': 0.8
          }
        });
      } else {
        map.setPaintProperty(layerId, 'line-gradient', stops as any);
      }
    });
  };

  // 初始化地图（沿用 EditorPage 的风格）
  useEffect(() => {
    if (!mapContainer.current) return;

    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/light-v10',
      center: [119.89600633, 32.22907004],
      zoom: 7,
    });

    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl(), 'top-right');

    map.on('load', () => {
      // 与 EditorPage 一样预留 uploaded-data 源供岸段使用
      map.addSource('uploaded-data', { type: 'geojson', data: turf.featureCollection([]) });
      map.addLayer({
        id: 'uploaded-lines-base',
        type: 'line',
        source: 'uploaded-data',
        filter: ['==', '$type', 'LineString'],
        paint: {
          'line-color': '#94a3b8',
          'line-width': 2
        }
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  const progressPercent = useMemo(() => {
    if (!progress) return 0;
    if (progress.expectedTotal <= 0) return 0;
    return Math.round((progress.processedCount / progress.expectedTotal) * 100);
  }, [progress]);

  const toggleErrorExpanded = (sectionId: string) => {
    const willExpand = !expandedErrorIds[sectionId];
    setExpandedErrorIds(prev => ({ ...prev, [sectionId]: willExpand }));
    if (willExpand && progress?.taskId && sectionId) loadErrorDetail(progress.taskId, sectionId);
  };

  return (
    <div className="map-wrapper">
      <div ref={mapContainer} className="map-full" />

      {progressOpen && selectedTask && (
        <div className="progress-drawer" onClick={(e) => e.stopPropagation()}>
          <div className="progress-modal progress-modal-drawer" >
            <div className="progress-modal-header">
              <div>
                <div className="progress-modal-title">计算进度</div>
                <div className="progress-modal-subtitle">
                  任务: {progress?.taskName || selectedTask}
                  {progress?.status ? ` | 状态: ${progress.status}` : ''}
                </div>
              </div>
              <button className="progress-modal-close" onClick={() => setProgressOpen(false)}>关闭</button>
            </div>

            <progress
              className="progress-bar-native"
              value={progress?.processedCount ?? 0}
              max={Math.max(1, progress?.expectedTotal ?? 1)}
            />

            <div className="progress-stats">
              <div>进度: {progressPercent}%</div>
              <div>
                已处理: {progress?.processedCount ?? 0}/{progress?.expectedTotal ?? 0}
                {' | '}成功: {progress?.successCount ?? 0}
                {' | '}失败: {progress?.errorCount ?? 0}
              </div>
              <div className="progress-updated">最后更新: {progress?.lastUpdatedAt ? new Date(progress.lastUpdatedAt).toLocaleTimeString() : '-'}</div>
            </div>

            {(progress?.errors?.length ?? 0) > 0 ? (
              <div className="progress-errors">
                <div className="progress-errors-title">出错断面</div>
                <div className="progress-errors-list">
                  {progress!.errors.map(err => {
                    const expanded = Boolean(expandedErrorIds[err.section_id]);
                    return (
                      <div key={err.section_id} className="progress-error-item">
                        <div className="progress-error-row">
                          <div className="progress-error-main">
                            <div className="progress-error-id">{err.section_name || err.section_id}</div>
                            <div className="progress-error-msg">{err.message}</div>
                          </div>
                          <button className="progress-error-toggle" onClick={() => toggleErrorExpanded(err.section_id)}>
                            {expanded ? '收起' : '查看详情'}
                          </button>
                        </div>

                        {expanded && (
                          <div className="progress-error-detail">
                            {err.detailError && <div className="progress-error-detail-error">{err.detailError}</div>}
                            <pre className="progress-error-pre">{JSON.stringify(err.detail ?? err.raw ?? err, null, 2)}</pre>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="progress-no-errors">暂无断面错误信息</div>
            )}
          </div>
        </div>
      )}

      <div className="upload-control result-sidebar">
        <div className="sidebar-header">
          <h4>任务列表</h4>
          <button 
            className={`toggle-sections-btn ${!showSections ? 'hidden' : ''}`}
            onClick={() => setShowSections(!showSections)}
          >
            {showSections ? '隐藏断面' : '显示断面'}
          </button>
        </div>
        <div className="task-list-container">
          {taskList.length === 0 && !loading && <p className="empty-hint">暂无任务</p>}
          {taskList.map(task => (
            <div 
              key={task.task_id} 
              className={`task-item ${selectedTask === task.task_id ? 'active' : ''}`}
              onClick={() => handleTaskClick(task.task_id)}
            >
              <div className="task-title">{task.task_name}</div>
              <div className="task-meta">
                ID: {task.task_id} | {new Date(task.created_at).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>

        <button
          className="delete-task-btn"
          disabled={!selectedTask || loading}
          onClick={handleDeleteTask}
        >
          删除选中任务
        </button>

        {loading && <div className="loading-spinner">数据加载中...</div>}
        {error && <p className="error-message">错误: {error}</p>}
        
        {selectedTask && !loading && (
          <div className="result-info">
            <h5>当前分析结果</h5>
            <div className="legend">
              <div className="legend-item"><span className="dot high"></span>极高风险</div>
              <div className="legend-item"><span className="dot medium"></span>高风险</div>
              <div className="legend-item"><span className="dot low"></span>一般风险</div>
              <div className="legend-item"><span className="dot no"></span>低/无风险</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ResultPage;
