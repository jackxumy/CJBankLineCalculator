import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import * as turf from '@turf/turf';
import 'mapbox-gl/dist/mapbox-gl.css';
import '../App.css';

// 与 EditorPage 保持一致的 Mapbox token
mapboxgl.accessToken = 'pk.eyJ1IjoieWNzb2t1IiwiYSI6ImNrenozdWdodDAza3EzY3BtdHh4cm5pangifQ.ZigfygDi2bK4HXY1pWh-wg';

// 后端返回的断面结构假设
interface BackendCrossSection {
  distance: number;          // 在线上的里程（米）
  shoreLineIndex?: number;   // 所属岸段索引
  shoreLineId?: string;      // 所属岸段ID，例如 line-0
  color?: string;            // 风险颜色（十六进制），如果已有
}

function ResultPage() {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  const [shoreGeoJSON, setShoreGeoJSON] = useState<GeoJSON.FeatureCollection | null>(null);
  const [crossSections, setCrossSections] = useState<BackendCrossSection[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 点击按钮：从后端获取岸段和断面并做可视化
  const handleLoadFromBackend = async () => {
    setLoading(true);
    setError(null);

    try {
      // 先获取岸段 GeoJSON
      const geoRes = await fetch('http://192.168.1.116:8088/v0/mi/cgeojsonget');
      if (!geoRes.ok) {
        throw new Error(`获取岸段失败: ${geoRes.status} ${geoRes.statusText}`);
      }
      const geoData = await geoRes.json();
      const geojson: GeoJSON.FeatureCollection =
        geoData.type === 'FeatureCollection' ? geoData : turf.featureCollection([geoData]);

      // 确保每条线有 index 属性，用于关联断面
      geojson.features.forEach((f: any, idx: number) => {
        if (!f.properties) f.properties = {};
        if (f.geometry && (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString')) {
          f.properties.index = idx;
        }
      });

      setShoreGeoJSON(geojson);

      // 再获取断面
      const crossRes = await fetch('http://192.168.1.116:8088/v0/mi/crossget');
      if (!crossRes.ok) {
        throw new Error(`获取断面失败: ${crossRes.status} ${crossRes.statusText}`);
      }
      const crossData = await crossRes.json();

      // 假设后端返回数组，每个元素至少包含 distance、shoreLineIndex/shoreLineId、color
      const list: BackendCrossSection[] = Array.isArray(crossData) ? crossData : [];
      setCrossSections(list);

      // 把岸段更新到地图
      const map = mapRef.current;
      if (map) {
        const src = map.getSource('uploaded-data') as mapboxgl.GeoJSONSource | null;
        if (src) src.setData(geojson);

        // 自动缩放到岸段范围
        if (geojson.features.length > 0) {
          const bbox = turf.bbox(geojson);
          map.fitBounds([bbox[0], bbox[1], bbox[2], bbox[3]], { padding: 50 });
        }
      }

      // 基于新的断面数据做颜色插值
      applyShorelineGradient(geojson, list);
    } catch (e: any) {
      console.error(e);
      setError(e.message || '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  // 使用 distance + 岸线隶属信息对岸段做颜色插值
  const applyShorelineGradient = (
    geojson: GeoJSON.FeatureCollection | null,
    crosses: BackendCrossSection[]
  ) => {
    const map = mapRef.current;
    if (!map || !geojson || crosses.length === 0) return;

    // 这里简单假设颜色已经在 crossSections.color 中给出
    // 若后端只给风险等级，可在此处映射到颜色
    const defaultColor = '#94a3b8';

    geojson.features.forEach((feature: any, idx: number) => {
      if (!feature.geometry || feature.geometry.type !== 'LineString') return;
      const line = feature as GeoJSON.Feature<GeoJSON.LineString>;
      const lineIndex = feature.properties?.index ?? idx;

      const related = crosses.filter(
        c => (c.shoreLineIndex !== undefined && c.shoreLineIndex === lineIndex) ||
             (c.shoreLineId && c.shoreLineId === `line-${lineIndex}`)
      );
      if (related.length === 0) return;

      const totalLength = turf.length(line, { units: 'meters' });
      if (totalLength <= 0) return;

      // 按 distance 排序
      const sorted = [...related].sort((a, b) => a.distance - b.distance);

      const grayColor = defaultColor;
      const rawStops: { val: number; color: string }[] = [];

      // 选区这里简单用整条线（0 ~ totalLength）
      const selStart = 0;
      const selEnd = totalLength;

      // 1. 起点之前的灰色段
      rawStops.push({ val: 0, color: grayColor });

      // 2. 选区起点颜色（如果有点在起点）
      const firstColor = sorted[0].color || '#10b981';
      rawStops.push({ val: selStart / totalLength, color: firstColor });

      // 3. 中间采样点
      sorted.forEach(pt => {
        const d = Math.max(selStart, Math.min(selEnd, pt.distance));
        const t = d / totalLength;
        rawStops.push({ val: t, color: pt.color || firstColor });
      });

      // 4. 选区终点颜色
      const lastColor = sorted[sorted.length - 1].color || firstColor;
      rawStops.push({ val: selEnd / totalLength, color: lastColor });

      // 5. 终点后的灰色段
      rawStops.push({ val: 1, color: grayColor });

      // 构建严格递增的 stops
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

      const layerId = `shoreline-layer-${lineIndex}`;
      const sourceId = `shoreline-source-${lineIndex}`;

      // 为每条线单独建一个 source + layer，应用各自的渐变
      if (!map.getSource(sourceId)) {
        map.addSource(sourceId, { type: 'geojson', data: line });
      } else {
        (map.getSource(sourceId) as mapboxgl.GeoJSONSource).setData(line);
      }

      if (!map.getLayer(layerId)) {
        map.addLayer({
          id: layerId,
          type: 'line',
          source: sourceId,
          paint: {
            'line-width': 4,
            'line-color': '#10b981',
            'line-gradient': stops
          }
        });
      } else {
        map.setPaintProperty(layerId, 'line-gradient', stops);
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

  return (
    <div className="map-wrapper">
      <div ref={mapContainer} className="map-full" />
      <div className="upload-control">
        <h4>结果可视化</h4>
        <button
          className="generate-button"
          onClick={handleLoadFromBackend}
          disabled={loading}
        >
          {loading ? '加载中…' : '从后端获取断面与岸段'}
        </button>
        {error && (
          <p style={{ color: 'red', marginTop: '8px' }}>错误: {error}</p>
        )}
        <p style={{ fontSize: '13px', color: '#64748b', marginTop: '8px' }}>
          点击按钮后，将从 /v0/mi/cgeojsonget 加载岸段，从 /v0/mi/crossget 加载断面，并按 distance 对对应岸段进行颜色插值。
        </p>
      </div>
    </div>
  );
}

export default ResultPage;
