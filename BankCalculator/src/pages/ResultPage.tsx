import { useEffect, useRef, useState } from 'react';
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

  const [taskList, setTaskList] = useState<Task[]>([]);
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSections, setShowSections] = useState(true);

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

  // 点击任务：获取任务详情（包含所有断面及其结果）并在地图可视化
  const handleTaskClick = async (taskId: string) => {
    setSelectedTask(taskId);
    setLoading(true);
    setError(null);

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
      // 1. 获取任务完整数据（包含断面信息）
      const res = await fetch(`/v0/bank/tasks/${taskId}/full`);
      if (!res.ok) throw new Error('获取任务详情失败');
      const data = await res.json();
      
      if (!data.success || !data.data) {
        throw new Error('返回数据格式错误');
      }

      const { sections } = data.data;
      const sectionResults: SectionResult[] = sections;
      let enrichedSections: SectionResult[] | null = null;

      // 打印每个断面的完整 JSON 到控制台，方便调试
      try {
        console.log(`任务 ${taskId} 返回断面数量:`, Array.isArray(sections) ? sections.length : 0);
        (sections || []).forEach((sec: any, idx: number) => {
          console.log(`Section[${idx}] =>`, sec);
        });

        // 基于每个断面的数据库 id，从 /v0/bank/results/{result_id} 获取计算结果并补充 risk_level
        const enriched = await Promise.all((sections || []).map(async (sec: any) => {
          // 后端 results 接口使用的是结果表的 id（示例中断面对象包含 id 字段）
          const resultId = sec.section_id;
          if (!resultId) return sec;

          try {
            const r = await fetch(`/v0/bank/results/${resultId}`);
            if (!r.ok) {
              console.warn(`获取 result ${resultId} 失败:`, r.status);
              return sec;
            }
            const jr = await r.json();
            if (jr && jr.success && jr.result) {
              // 将后端返回的 risk_level（数字）附加到断面对象
              sec.risk_level = jr.result.risk_level;
            }
          } catch (err) {
            console.warn(`请求 result ${resultId} 出错:`, err);
          }

          return sec;
        }));

        // 使用补充后的断面集合继续后续渲染
        enrichedSections = enriched as SectionResult[];
      } catch (logErr) {
        console.warn('打印断面 JSON 或获取结果时出错:', logErr);
      }

      // 2. 获取所有岸段列表以支持名称（不再需要原始几何，但可用于过滤）
      const geoRes = await fetch('/v0/bank/banks');
      if (!geoRes.ok) throw new Error('获取岸段数据失败');
      const geoData = await geoRes.json();
      console.log('获取岸段数量:', geoData.banks?.length || 0);

      const sectionsToUseFinal = enrichedSections && enrichedSections.length > 0 ? enrichedSections : sectionResults;

      // 3. 执行基于断面中点的岸线生成与颜色插值
      applyShorelineGradient(sectionsToUseFinal);

      // 4. 渲染具体的断面线
      renderSections(sectionsToUseFinal);

      // 自动缩放到生成的断面范围
      const map = mapRef.current;
      if (map && sectionsToUseFinal.length > 0) {
        const sectionFeatures = sectionsToUseFinal
          .filter(s => s.geometry)
          .map(s => ({ type: 'Feature', geometry: s.geometry, properties: {} }));
        if (sectionFeatures.length > 0) {
          const bbox = turf.bbox({ type: 'FeatureCollection', features: sectionFeatures as any });
          map.fitBounds([bbox[0], bbox[1], bbox[2], bbox[3]], { padding: 80 });
        }
      }

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
      setSelectedTask(null);

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

    // 清理旧的断面图层和数据源
    ['sections-line-hit', 'sections-line'].forEach(layer => {
      if (map.getLayer(layer)) map.removeLayer(layer);
    });
    if (map.getSource('sections-source')) map.removeSource('sections-source');

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

    map.addSource('sections-source', {
      type: 'geojson',
      data: turf.featureCollection(features as any)
    });

    // 添加断面显示层 (带宽度，由风险值决定颜色)
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
        'line-width': 4,
        'line-opacity': 0.9
      }
    });

    // 增加一个透明的宽层方便鼠标点击交互
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

    // 悬浮显示气泡
    map.on('click', 'sections-line-hit', (e) => {
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
    });

    map.on('mouseenter', 'sections-line-hit', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'sections-line-hit', () => { map.getCanvas().style.cursor = ''; });
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
      const bankSections = groups[bankId].sort((a, b) => a.distance - b.distance);
      if (bankSections.length < 2) return; // 至少需要 2 个中点才能连成线

      // 计算每个断面中点并构建 LineString
      const midpoints: number[][] = [];
      const riskStops: { val: number; color: string }[] = [];

      bankSections.forEach(s => {
        if (!s.geometry || s.geometry.type !== 'LineString') return;
        
        // 计算中点 (断面为 2 个坐标的 LineString)
        const coords = s.geometry.coordinates;
        const mid = [
          (coords[0][0] + coords[1][0]) / 2,
          (coords[0][1] + coords[1][1]) / 2
        ];
        midpoints.push(mid);
      });

      if (midpoints.length < 2) return;

      const newLine = turf.lineString(midpoints);
      const totalDist = turf.length(newLine, { units: 'meters' });

      // 构建颜色梯度参数
      let currentDist = 0;
      bankSections.forEach((s, idx) => {
        if (idx > 0) {
          const prevMid = midpoints[idx - 1];
          const currMid = midpoints[idx];
          currentDist += turf.distance(prevMid, currMid, { units: 'meters' });
        }

        const info = getRiskInfo(s.risk_level);
        const color = info.color;

        const progress = totalDist > 0 ? (currentDist / totalDist) : 0;
        riskStops.push({ val: progress, color });
      });

      // Mapbox interpolate 表达式格式
      const stops: any[] = ['interpolate', ['linear'], ['line-progress']];
      riskStops.forEach(rs => {
        const val = Math.max(0, Math.min(1, rs.val));
        stops.push(val, rs.color);
      });

      // 渲染新生成的中间折线
      const layerId = `midline-result-${bankId}`;
      const sourceId = `midline-source-${bankId}`;

      if (map.getLayer(layerId)) map.removeLayer(layerId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);

      map.addSource(sourceId, { type: 'geojson', data: newLine, lineMetrics: true });
      map.addLayer({
        id: layerId,
        type: 'line',
        source: sourceId,
        paint: {
          'line-width': 10,
          'line-gradient': stops as any,
          'line-opacity': 0.8
        }
      });
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

  return (
    <div className="map-wrapper">
      <div ref={mapContainer} className="map-full" />
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
