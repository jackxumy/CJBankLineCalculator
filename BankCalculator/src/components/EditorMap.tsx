import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import * as turf from '@turf/turf';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { SelectionGroup } from '../types/selection';

mapboxgl.accessToken = 'pk.eyJ1IjoieWNzb2t1IiwiYSI6ImNrenozdWdodDAza3EzY3BtdHh4cm5pangifQ.ZigfygDi2bK4HXY1pWh-wg';

interface EditorMapProps {
  perpendicularData: GeoJSON.FeatureCollection | null;
  uploadedData: GeoJSON.FeatureCollection | null;
  groups: SelectionGroup[];
  showCrossLines: boolean;
  isSelectingShoreLines: boolean;
  isSelectingStartEnd: boolean;
  isSelectingCrossLines: boolean;
  crossLineEditMode: 'select' | 'add';
  selectedLines: Set<string>;
  setSelectedLines: React.Dispatch<React.SetStateAction<Set<string>>>;
  setGroups: React.Dispatch<React.SetStateAction<SelectionGroup[]>>;
  selectedCrossLineIndex: number | null;
  setSelectedCrossLineIndex: (index: number | null) => void;
  globalInterval: number;
  globalLength: number;
  createCrossLineAtPoint: (line: GeoJSON.Feature<GeoJSON.LineString>, distanceOnLine: number) => void;
}

function EditorMap(props: EditorMapProps) {
  const {
    perpendicularData,
    uploadedData,
    groups,
    showCrossLines,
    isSelectingShoreLines,
    isSelectingStartEnd,
    isSelectingCrossLines,
    crossLineEditMode,
    selectedLines,
    setSelectedLines,
    setGroups,
    selectedCrossLineIndex,
    setSelectedCrossLineIndex,
    globalInterval,
    globalLength,
    createCrossLineAtPoint,
  } = props;

  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  const groupsRef = useRef<SelectionGroup[]>(groups);
  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);

  const isSelectingShoreLinesRef = useRef(isSelectingShoreLines);
  useEffect(() => {
    isSelectingShoreLinesRef.current = isSelectingShoreLines;
  }, [isSelectingShoreLines]);

  const isSelectingStartEndRef = useRef(isSelectingStartEnd);
  useEffect(() => {
    isSelectingStartEndRef.current = isSelectingStartEnd;
  }, [isSelectingStartEnd]);

  const isSelectingCrossLinesRef = useRef(isSelectingCrossLines);
  useEffect(() => {
    isSelectingCrossLinesRef.current = isSelectingCrossLines;
  }, [isSelectingCrossLines]);

  const crossLineEditModeRef = useRef<'select' | 'add'>(crossLineEditMode);
  useEffect(() => {
    crossLineEditModeRef.current = crossLineEditMode;
  }, [crossLineEditMode]);

  const selectedCrossLineIndexRef = useRef<number | null>(selectedCrossLineIndex);
  useEffect(() => {
    selectedCrossLineIndexRef.current = selectedCrossLineIndex;
  }, [selectedCrossLineIndex]);

  const configRef = useRef({ interval: globalInterval, length: globalLength });
  useEffect(() => {
    configRef.current = { interval: globalInterval, length: globalLength };
  }, [globalInterval, globalLength]);

  // 同步垂线到地图数据源
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const updateMapSources = () => {
      const crossLinesSource = map.getSource('perpendicular-lines') as mapboxgl.GeoJSONSource;
      if (crossLinesSource) {
        crossLinesSource.setData(perpendicularData || turf.featureCollection([]));
      }
    };

    if (map.isStyleLoaded()) {
      updateMapSources();
    } else {
      map.once('idle', updateMapSources);
    }
  }, [perpendicularData]);

  // 同步上传的数据到地图，并在首次上传时适配视图范围
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !uploadedData) return;

    const updateSource = () => {
      const source = map.getSource('uploaded-data') as mapboxgl.GeoJSONSource;
      if (source) {
        source.setData(uploadedData);
      }

      if (uploadedData.features.length > 0) {
        const bbox = turf.bbox(uploadedData);
        map.fitBounds([bbox[0], bbox[1], bbox[2], bbox[3]], { padding: 50 });
      }
    };

    if (map.isStyleLoaded()) {
      updateSource();
    } else {
      map.once('idle', updateSource);
    }
  }, [uploadedData]);

  // 同步选中线段的高亮显示
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !uploadedData) return;

    const updateSelectedLines = () => {
      const selectedSource = map.getSource('selected-shore-lines') as mapboxgl.GeoJSONSource;
      if (selectedSource) {
        const selectedFeatures = uploadedData.features.filter((_, index) =>
          selectedLines.has(`line-${index}`),
        );
        selectedSource.setData(turf.featureCollection(selectedFeatures));
      }
    };

    if (map.isStyleLoaded()) {
      updateSelectedLines();
    } else {
      map.once('idle', updateSelectedLines);
    }
  }, [selectedLines, uploadedData]);

  // 同步选择组数据到地图
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const updateMapSources = () => {
      const pointSource = map.getSource('selection-points') as mapboxgl.GeoJSONSource;
      if (pointSource) {
        const allPoints: GeoJSON.Feature<GeoJSON.Point>[] = [];
        groups.forEach((group) => {
          if (group.start !== null) {
            allPoints.push(turf.along(group.line, group.start, { units: 'meters' }) as GeoJSON.Feature<GeoJSON.Point>);
          }
          if (group.end !== null) {
            allPoints.push(turf.along(group.line, group.end, { units: 'meters' }) as GeoJSON.Feature<GeoJSON.Point>);
          }
        });
        pointSource.setData(turf.featureCollection(allPoints));
      }

      const activeLineSource = map.getSource('active-line') as mapboxgl.GeoJSONSource;
      if (activeLineSource) {
        const segments: GeoJSON.Feature<GeoJSON.LineString>[] = [];
        groups.forEach((group) => {
          if (group.start !== null && group.end !== null) {
            try {
              const start = Math.min(group.start, group.end);
              const end = Math.max(group.start, group.end);
              const segment = turf.lineSliceAlong(group.line, start, end, { units: 'meters' });
              segment.properties = { groupId: group.id };
              segments.push(segment as GeoJSON.Feature<GeoJSON.LineString>);
            } catch (err) {
              console.warn('切割线段失败', err);
            }
          }
        });
        activeLineSource.setData(turf.featureCollection(segments));
      }
    };

    if (map.isStyleLoaded()) {
      updateMapSources();
    } else {
      map.once('idle', updateMapSources);
    }
  }, [groups]);

  // 控制垂线图层显隐
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (map.getLayer('perpendicular-lines-layer')) {
      map.setLayoutProperty('perpendicular-lines-layer', 'visibility', showCrossLines ? 'visible' : 'none');
    }
    if (map.getLayer('perpendicular-lines-hit-target')) {
      map.setLayoutProperty('perpendicular-lines-hit-target', 'visibility', showCrossLines ? 'visible' : 'none');
    }
  }, [showCrossLines]);

  // 同步选中断面的高亮显示
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !perpendicularData) return;

    const updateSelectedCrossLine = () => {
      const selectedSource = map.getSource('selected-cross-line') as mapboxgl.GeoJSONSource;
      if (selectedSource) {
        if (selectedCrossLineIndex !== null && perpendicularData.features[selectedCrossLineIndex]) {
          selectedSource.setData(turf.featureCollection([perpendicularData.features[selectedCrossLineIndex]]));
        } else {
          selectedSource.setData(turf.featureCollection([]));
        }
      }
    };

    if (map.isStyleLoaded()) {
      updateSelectedCrossLine();
    } else {
      map.once('idle', updateSelectedCrossLine);
    }
  }, [selectedCrossLineIndex, perpendicularData]);

  // 初始化地图和交互
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
      map.addSource('perpendicular-lines', { type: 'geojson', data: turf.featureCollection([]) });
      map.addSource('uploaded-data', { type: 'geojson', data: turf.featureCollection([]) });
      map.addSource('selection-points', { type: 'geojson', data: turf.featureCollection([]) });
      map.addSource('snap-point', { type: 'geojson', data: turf.featureCollection([]) });
      map.addSource('active-line', { type: 'geojson', data: turf.featureCollection([]), lineMetrics: true });
      map.addSource('selected-shore-lines', { type: 'geojson', data: turf.featureCollection([]) });

      map.addLayer({
        id: 'uploaded-lines-hit-target',
        type: 'line',
        source: 'uploaded-data',
        filter: ['==', '$type', 'LineString'],
        paint: {
          'line-width': 30,
          'line-opacity': 0,
        },
      });

      map.addLayer({
        id: 'uploaded-lines',
        type: 'line',
        source: 'uploaded-data',
        filter: ['==', '$type', 'LineString'],
        paint: {
          'line-color': '#94a3b8',
          'line-width': 2,
        },
      });

      map.addLayer({
        id: 'selected-shore-lines-layer',
        type: 'line',
        source: 'selected-shore-lines',
        filter: ['==', '$type', 'LineString'],
        paint: {
          'line-color': '#f59e0b',
          'line-width': 4,
        },
      });

      map.addLayer({
        id: 'active-line-layer',
        type: 'line',
        source: 'active-line',
        paint: {
          'line-color': '#10b981',
          'line-width': 6,
        },
      });

      map.addLayer({
        id: 'perpendicular-lines-hit-target',
        type: 'line',
        source: 'perpendicular-lines',
        paint: {
          'line-width': 20,
          'line-opacity': 0,
        },
      });

      map.addLayer({
        id: 'perpendicular-lines-layer',
        type: 'line',
        source: 'perpendicular-lines',
        paint: { 'line-color': '#ef4444', 'line-width': 2 },
      });

      map.addSource('selected-cross-line', { type: 'geojson', data: turf.featureCollection([]) });
      map.addLayer({
        id: 'selected-cross-line-layer',
        type: 'line',
        source: 'selected-cross-line',
        paint: { 'line-color': '#3b82f6', 'line-width': 4 },
      });

      map.addLayer({
        id: 'points-layer',
        type: 'circle',
        source: 'selection-points',
        paint: {
          'circle-radius': 8,
          'circle-color': '#3b82f6',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      });

      map.addLayer({
        id: 'snap-point-layer',
        type: 'circle',
        source: 'snap-point',
        paint: {
          'circle-radius': 5,
          'circle-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#3b82f6',
        },
      });

      const hitLayers = ['uploaded-lines-hit-target'];
      const crossLineHitLayers = ['perpendicular-lines-hit-target'];

      map.on('click', (e) => {
        if (isSelectingCrossLinesRef.current) {
          const editMode = crossLineEditModeRef.current;

          if (editMode === 'select') {
            const crossLineFeatures = map.queryRenderedFeatures(e.point, { layers: crossLineHitLayers });
            console.log(`点击断面，查询到 ${crossLineFeatures?.length || 0} 个要素`);

            if (crossLineFeatures && crossLineFeatures.length > 0) {
              const clickedFeature = crossLineFeatures[0];
              const crossLineId = clickedFeature.properties?.crossLineId as number | undefined;

              console.log(`点击的断面ID: ${crossLineId}`);

              if (crossLineId !== undefined && crossLineId !== null) {
                setSelectedCrossLineIndex(crossLineId);
                console.log(`选中断面索引: ${crossLineId}`);
              } else {
                console.warn('断面没有crossLineId属性，尝试坐标匹配');
              }
            }
          } else if (editMode === 'add') {
            const shoreLineFeatures = map.queryRenderedFeatures(e.point, { layers: hitLayers });

            if (shoreLineFeatures && shoreLineFeatures.length > 0) {
              const clickedFeature = shoreLineFeatures[0];
              const lineGeo = clickedFeature.geometry as GeoJSON.LineString;
              const lineFeature = turf.feature(lineGeo, clickedFeature.properties) as GeoJSON.Feature<GeoJSON.LineString>;

              const snapped = turf.nearestPointOnLine(lineFeature, [e.lngLat.lng, e.lngLat.lat], { units: 'meters' });
              const distanceOnLine = snapped.properties.location ?? 0;

              console.log(`点击岸段新建断面，距离: ${distanceOnLine.toFixed(2)}m`);
              createCrossLineAtPoint(lineFeature, distanceOnLine);
            }
          }
          return;
        }

        const features = map.queryRenderedFeatures(e.point, { layers: hitLayers });
        const feature = features?.[0];

        if (!feature) return;

        const lineGeo = feature.geometry as GeoJSON.LineString;
        const lineFeature = turf.feature(lineGeo, feature.properties) as GeoJSON.Feature<GeoJSON.LineString>;

        const lineIndex = feature.properties?.index as number | undefined;
        const lineId = lineIndex !== undefined ? `line-${lineIndex}` : `line-${Math.random()}`;

        if (isSelectingShoreLinesRef.current) {
          setSelectedLines((prev) => {
            const newSet = new Set(prev);
            if (newSet.has(lineId)) {
              newSet.delete(lineId);
              console.log(`取消选择岸段: ${lineId}`);
            } else {
              newSet.add(lineId);
              console.log(`选择岸段: ${lineId}`);
            }
            return newSet;
          });
          return;
        }

        if (!isSelectingStartEndRef.current) {
          return;
        }

        const snapped = turf.nearestPointOnLine(lineFeature, [e.lngLat.lng, e.lngLat.lat], { units: 'meters' });
        const dist = snapped.properties.location ?? 0;
        const totalLineLength = turf.length(lineFeature, { units: 'meters' });

        const currentGroups = groupsRef.current;
        const activeIndex = currentGroups.findIndex((g) => g.end === null);
        const { interval, length } = configRef.current;

        if (activeIndex === -1) {
          console.log(
            `[设置起点] 线索引: ${lineIndex}, 距离: ${dist.toFixed(2)}m, 整线归一化: ${(dist / totalLineLength).toFixed(4)}`,
          );
          const newGroup: SelectionGroup = {
            id: Math.random().toString(36).substr(2, 9),
            line: lineFeature,
            lineIndex: lineIndex,
            start: dist,
            end: null,
            interval: interval,
            lastAppliedInterval: interval,
            length: length,
            crossData: [],
          };
          setGroups((prev) => [...prev, newGroup]);
        } else {
          const activeGroup = currentGroups[activeIndex];
          const isSameLine = lineIndex !== undefined && lineIndex === activeGroup.lineIndex;

          if (isSameLine) {
            console.log(
              `[设置终点] 线索引: ${lineIndex}, 距离: ${dist.toFixed(2)}m, 整线归一化: ${(dist / totalLineLength).toFixed(4)}`,
            );

            setGroups((prev) => {
              const updated = [...prev];
              const idx = updated.findIndex((g) => g.id === activeGroup.id);
              if (idx !== -1) {
                updated[idx] = { ...activeGroup, end: dist };
              }
              return updated;
            });
          } else {
            console.log(
              `[跨线点击] 从线${activeGroup.lineIndex}跳到线${lineIndex}，重置起点: ${dist.toFixed(2)}m`,
            );

            const newGroup: SelectionGroup = {
              id: Math.random().toString(36).substr(2, 9),
              line: lineFeature,
              lineIndex: lineIndex,
              start: dist,
              end: null,
              interval: interval,
              lastAppliedInterval: interval,
              length: length,
              crossData: [],
            };

            setGroups((prev) => {
              const filtered = prev.filter((g) => g.end !== null);
              return [...filtered, newGroup];
            });
          }
        }
      });

      map.on('mousemove', crossLineHitLayers, (e) => {
        if (isSelectingCrossLinesRef.current && crossLineEditModeRef.current === 'select') {
          map.getCanvas().style.cursor = 'pointer';

          const features = e.features;
          if (features && features.length > 0) {
            const feature = features[0];
            const geometry = feature.geometry as GeoJSON.LineString;
            const coords = geometry.coordinates;

            const midPoint = turf.point([
              (coords[0][0] + coords[1][0]) / 2,
              (coords[0][1] + coords[1][1]) / 2,
            ]);

            const source = map.getSource('snap-point') as mapboxgl.GeoJSONSource;
            if (source) source.setData(midPoint);
          }
        }
      });

      map.on('mousemove', hitLayers, (e) => {
        if (isSelectingCrossLinesRef.current && crossLineEditModeRef.current === 'add') {
          map.getCanvas().style.cursor = 'crosshair';

          const feature = e.features?.[0];
          if (!feature) return;

          const lineGeo = feature.geometry as GeoJSON.LineString;
          const lineFeature = turf.feature(lineGeo) as GeoJSON.Feature<GeoJSON.LineString>;

          const snapped = turf.nearestPointOnLine(lineFeature, [e.lngLat.lng, e.lngLat.lat], { units: 'meters' });
          const source = map.getSource('snap-point') as mapboxgl.GeoJSONSource;
          if (source) source.setData(snapped);
          return;
        }

        if (!isSelectingShoreLinesRef.current && !isSelectingStartEndRef.current) {
          return;
        }

        const feature = e.features?.[0];
        if (!feature) return;

        const lineGeo = feature.geometry as GeoJSON.LineString;
        const lineFeature = turf.feature(lineGeo) as GeoJSON.Feature<GeoJSON.LineString>;

        const snapped = turf.nearestPointOnLine(lineFeature, [e.lngLat.lng, e.lngLat.lat], { units: 'meters' });
        const source = map.getSource('snap-point') as mapboxgl.GeoJSONSource;
        if (source) source.setData(snapped);

        map.getCanvas().style.cursor = 'pointer';
      });

      map.on('mouseleave', hitLayers, () => {
        const source = map.getSource('snap-point') as mapboxgl.GeoJSONSource;
        if (source) source.setData(turf.featureCollection([]));

        map.getCanvas().style.cursor = '';
      });

      map.on('mousemove', crossLineHitLayers, (e) => {
        if (isSelectingCrossLinesRef.current) {
          map.getCanvas().style.cursor = 'pointer';

          const features = e.features;
          if (features && features.length > 0) {
            const feature = features[0];
            const geometry = feature.geometry as GeoJSON.LineString;
            const coords = geometry.coordinates;

            const midPoint = turf.point([
              (coords[0][0] + coords[1][0]) / 2,
              (coords[0][1] + coords[1][1]) / 2,
            ]);

            const source = map.getSource('snap-point') as mapboxgl.GeoJSONSource;
            if (source) source.setData(midPoint);
          }
        }
      });

      map.on('mouseleave', crossLineHitLayers, () => {
        if (isSelectingCrossLinesRef.current) {
          map.getCanvas().style.cursor = '';

          const source = map.getSource('snap-point') as mapboxgl.GeoJSONSource;
          if (source) source.setData(turf.featureCollection([]));
        }
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  return <div ref={mapContainer} className="map-full" />;
}

export default EditorMap;
