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
  distance: number;
  bank_id: string;
  geometry: any;
  risk_level?: string; // high, medium, low, no
  risk_score?: number;
}

// 颜色映射参考 App copy.tsx 中的 RISK_COLORS
const RISK_COLORS: Record<string, string> = {
  'high': '#ef4444',
  'medium': '#f97316',
  'low': '#facc15',
  'no': '#10b981',
  'default': '#94a3b8'
};

function ResultPage() {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  const [taskList, setTaskList] = useState<Task[]>([]);
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

      // 2. 获取所有岸段空间数据
      const geoRes = await fetch('/v0/bank/banks');
      if (!geoRes.ok) throw new Error('获取岸段空间数据失败');
      const geoData = await geoRes.json();
      
      const allBanksGeoJSON: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: (geoData.banks || []).map((b: any) => ({
          type: 'Feature',
          properties: { 
            index: b.id, 
            bank_id: b.bank_id,
            bank_name: b.bank_name 
          },
          geometry: b.geometry
        }))
      };

      // 3. 更新地图全量岸段底色（灰色）
      const map = mapRef.current;
      if (map) {
        const src = map.getSource('uploaded-data') as mapboxgl.GeoJSONSource | null;
        if (src) src.setData(allBanksGeoJSON);

        // 自动缩放到相关岸段范围
        const relevantFeatures = allBanksGeoJSON.features.filter(f => 
          sectionResults.some(s => s.bank_id === (f.properties as any).bank_id)
        );
if (relevantFeatures.length > 0) {
          const bbox = turf.bbox({ type: 'FeatureCollection', features: relevantFeatures });
          map.fitBounds([bbox[0], bbox[1], bbox[2], bbox[3]], { padding: 80 });
        }
      }

      // 4. 执行插值可视化
      applyShorelineGradient(allBanksGeoJSON, sectionResults);

    } catch (e: any) {
      console.error(e);
      setError(e.message || '加载任务数据失败');
    } finally {
      setLoading(false);
    }
  };

  // 颜色插值逻辑
  const applyShorelineGradient = (
    geojson: GeoJSON.FeatureCollection,
    sections: SectionResult[]
  ) => {
    const map = mapRef.current;
    if (!map || !geojson) return;

    geojson.features.forEach((feature: any) => {
      const bankId = feature.properties?.bank_id;
      if (!bankId) return;

      // 找到属于该岸段的所有断面
      const bankSections = sections.filter(s => s.bank_id === bankId);
      if (bankSections.length === 0) return;

      const line = feature as GeoJSON.Feature<GeoJSON.LineString>;
      if (line.geometry.type !== 'LineString') return; 

      const totalLength = turf.length(line, { units: 'meters' });
      if (totalLength <= 0) return;

      const sorted = [...bankSections].sort((a, b) => a.distance - b.distance);
      const rawStops: { val: number; color: string }[] = [];

      sorted.forEach(s => {
        const color = RISK_COLORS[s.risk_level || 'no'] || RISK_COLORS.no;
        rawStops.push({ val: s.distance / totalLength, color });
      });

      if (rawStops.length > 0) {
        if (rawStops[0].val > 0) rawStops.unshift({ val: 0, color: rawStops[0].color });
        if (rawStops[rawStops.length - 1].val < 1) rawStops.push({ val: 1, color: rawStops[rawStops.length - 1].color });
      }

      const stops: any[] = ['interpolate', ['linear'], ['line-progress']];
      let lastVal = -1;
      rawStops
        .sort((a, b) => a.val - b.val)
        .forEach(s => {
          const currentVal = Math.max(0, Math.min(1, s.val));
          if (currentVal > lastVal) {
            stops.push(currentVal, s.color);
            lastVal = currentVal;
          }
        });

      const layerId = `shoreline-result-${bankId}`;
      const sourceId = `shoreline-source-${bankId}`;

      if (map.getLayer(layerId)) map.removeLayer(layerId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);

      map.addSource(sourceId, { type: 'geojson', data: line, lineMetrics: true });
      map.addLayer({
        id: layerId,
        type: 'line',
        source: sourceId,
        paint: {
          'line-width': 6,
          'line-gradient': stops
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
        <h4>任务列表</h4>
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
