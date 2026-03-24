import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import * as turf from '@turf/turf';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { SelectionGroup } from '../types/selection';

mapboxgl.accessToken = 'pk.eyJ1IjoieWNzb2t1IiwiYSI6ImNrenozdWdodDAza3EzY3BtdHh4cm5pangifQ.ZigfygDi2bK4HXY1pWh-wg';

function buildCrossLineArrowPoints(
  data: GeoJSON.FeatureCollection | null,
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  if (!data || !data.features.length) {
    return turf.featureCollection([]) as GeoJSON.FeatureCollection<GeoJSON.Point>;
  }

  const arrowPoints: GeoJSON.Feature<GeoJSON.Point>[] = [];

  data.features.forEach((feature) => {
    if (feature.geometry.type !== 'LineString') return;
    const coords = feature.geometry.coordinates;
    if (!coords || coords.length < 2) return;

    const start = coords[0];
    const end = coords[coords.length - 1];
    const bearing = turf.bearing(turf.point(start), turf.point(end));
    // 参考 Mapbox 图标默认朝向与正北夹角，做 -90 度修正
    const iconRotate = Number(bearing - 90);

    const props: any = feature.properties || {};

    arrowPoints.push({
      type: 'Feature',
      properties: {
        iconRotate,
        validation_status: props.validation_status,
        is_valid: props.is_valid,
      },
      geometry: {
        type: 'Point',
        coordinates: end,
      },
    });
  });

  return turf.featureCollection(arrowPoints) as GeoJSON.FeatureCollection<GeoJSON.Point>;
}

function buildValidationColorExpression() {
  // pending/unknown => yellow, valid => green, invalid => red
  return [
    'case',
    ['==', ['get', 'validation_status'], 'valid'],
    '#22c55e',
    ['==', ['get', 'validation_status'], 'invalid'],
    '#ef4444',
    ['==', ['get', 'is_valid'], true],
    '#22c55e',
    ['==', ['get', 'is_valid'], false],
    '#ef4444',
    '#f59e0b',
  ] as any;
}

interface EditorMapProps {
  perpendicularData: GeoJSON.FeatureCollection | null;
  uploadedData: GeoJSON.FeatureCollection | null;
  groups: SelectionGroup[];
  showCrossLines: boolean;
  isSelectingShoreLines: boolean;
  isSelectingStartEnd: boolean;
  isSelectingCrossLines: boolean;
  crossLineControlMode: 'shoreline' | 'free';
  crossLineEditMode: 'none' | 'select' | 'add';
  selectedLines: Set<string>;
  setSelectedLines: React.Dispatch<React.SetStateAction<Set<string>>>;
  setGroups: React.Dispatch<React.SetStateAction<SelectionGroup[]>>;
  selectedCrossLineIndex: number | null;
  setSelectedCrossLineIndex: (index: number | null) => void;
  globalInterval: number;
  globalLength: number;
  createCrossLineAtPoint: (line: GeoJSON.Feature<GeoJSON.LineString>, distanceOnLine: number) => void;
  updateCrossLineGeometryLocal: (crossLineIndex: number, geometry: GeoJSON.LineString) => void;
  persistCrossLineGeometry: (crossLineIndex: number, geometry: GeoJSON.LineString) => void;
  createCrossLineByEndpoints: (start: number[], end: number[]) => void;
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
    crossLineControlMode,
    crossLineEditMode,
    selectedLines,
    setSelectedLines,
    setGroups,
    selectedCrossLineIndex,
    setSelectedCrossLineIndex,
    globalInterval,
    globalLength,
    createCrossLineAtPoint,
    updateCrossLineGeometryLocal,
    persistCrossLineGeometry,
    createCrossLineByEndpoints,
  } = props;

  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  const perpendicularDataRef = useRef<GeoJSON.FeatureCollection | null>(perpendicularData);
  useEffect(() => {
    perpendicularDataRef.current = perpendicularData;
  }, [perpendicularData]);

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

  const crossLineControlModeRef = useRef<'shoreline' | 'free'>(crossLineControlMode);
  useEffect(() => {
    crossLineControlModeRef.current = crossLineControlMode;
  }, [crossLineControlMode]);

  const crossLineEditModeRef = useRef<'none' | 'select' | 'add'>(crossLineEditMode);
  useEffect(() => {
    crossLineEditModeRef.current = crossLineEditMode;
  }, [crossLineEditMode]);

  // 退出断面精调/释放选择时，清理吸附点与鼠标样式
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (isSelectingCrossLines) return;

    const source = map.getSource('snap-point') as mapboxgl.GeoJSONSource;
    if (source) source.setData(turf.featureCollection([]));
    map.getCanvas().style.cursor = '';
  }, [isSelectingCrossLines]);

  const updateCrossLineGeometryLocalRef = useRef(updateCrossLineGeometryLocal);
  useEffect(() => {
    updateCrossLineGeometryLocalRef.current = updateCrossLineGeometryLocal;
  }, [updateCrossLineGeometryLocal]);

  const persistCrossLineGeometryRef = useRef(persistCrossLineGeometry);
  useEffect(() => {
    persistCrossLineGeometryRef.current = persistCrossLineGeometry;
  }, [persistCrossLineGeometry]);

  const createCrossLineByEndpointsRef = useRef(createCrossLineByEndpoints);
  useEffect(() => {
    createCrossLineByEndpointsRef.current = createCrossLineByEndpoints;
  }, [createCrossLineByEndpoints]);

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

      const crossArrowsSource = map.getSource('perpendicular-arrows') as mapboxgl.GeoJSONSource;
      if (crossArrowsSource) {
        crossArrowsSource.setData(buildCrossLineArrowPoints(perpendicularData));
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
    if (map.getLayer('perpendicular-arrows-layer')) {
      map.setLayoutProperty('perpendicular-arrows-layer', 'visibility', showCrossLines ? 'visible' : 'none');
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
      map.addSource('perpendicular-arrows', { type: 'geojson', data: turf.featureCollection([]) });
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
        paint: { 'line-color': buildValidationColorExpression(), 'line-width': 4 },
      });

      map.addLayer({
        id: 'perpendicular-arrows-layer',
        type: 'symbol',
        source: 'perpendicular-arrows',
        layout: {
          'text-field': '▶',
          'text-size': 20,
          'text-rotate': ['get', 'iconRotate'],
          'text-rotation-alignment': 'map',
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: {
          'text-color': buildValidationColorExpression(),
          'text-halo-color': '#ffffff',
          'text-halo-width': 2,
        },
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

      const freeAddStartRef: { current: number[] | null } = { current: null };

      let infoPopup: mapboxgl.Popup | null = null;

      const closeInfoPopup = () => {
        if (!infoPopup) return;
        infoPopup.remove();
        infoPopup = null;
      };

      const escapeHtml = (value: any) => {
        const s = value === null || value === undefined ? '' : String(value);
        return s
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;')
          .replaceAll("'", '&#039;');
      };

      const openCrossLineInfoPopup = (lngLat: mapboxgl.LngLat, props: any) => {
        closeInfoPopup();

        const sectionId = props?.sectionId ?? props?.section_id ?? props?.id;
        const isValid = props?.is_valid;
        const status = props?.validation_status;
        const rawStatus = props?.validation_status_raw;
        const message = props?.validation_message;
        const error = props?.validation_error;

        let label = '未验证';
        let color = '#f59e0b';
        if (status === 'valid' || isValid === true) {
          label = '通过';
          color = '#22c55e';
        } else if (status === 'invalid' || isValid === false) {
          label = '未通过';
          color = '#ef4444';
        }

        const detailHtml: string[] = [];
        if (label === '未通过') {
          const detail = message || rawStatus;
          if (detail) {
            detailHtml.push(
              `<p style="margin:4px 0 0; font-size:12px; color:#64748b;">问题: ${escapeHtml(detail)}</p>`,
            );
          }
        } else if (label === '未验证' && error) {
          detailHtml.push(
            `<p style="margin:4px 0 0; font-size:12px; color:#64748b;">上次请求失败: ${escapeHtml(error)}</p>`,
          );
        }

        infoPopup = new mapboxgl.Popup()
          .setLngLat(lngLat)
          .setHTML(`
            <div style="padding: 4px; font-family: sans-serif;">
              <p style="margin:0; font-weight:bold; color:#1e293b;">断面校验状态</p>
              <p style="margin:4px 0 0; font-size:12px; color:#64748b;">断面ID: ${escapeHtml(sectionId || '未知')}</p>
              <p style="margin:4px 0 0; font-size:12px; color:#64748b;">状态: <span style="color:${color}; font-weight:bold;">${label}</span></p>
              ${detailHtml.join('')}
            </div>
          `)
          .addTo(map);
      };

      let dragState:
        | {
            crossLineId: number;
            startLngLat: mapboxgl.LngLat;
            startCoords: number[][];
            lastCoords: number[][];
          }
        | null = null;

      const onDragMove = (ev: mapboxgl.MapMouseEvent) => {
        if (!dragState) return;
        const dx = ev.lngLat.lng - dragState.startLngLat.lng;
        const dy = ev.lngLat.lat - dragState.startLngLat.lat;
        const nextCoords = dragState.startCoords.map((c) => [c[0] + dx, c[1] + dy]);
        dragState.lastCoords = nextCoords;
        updateCrossLineGeometryLocalRef.current(dragState.crossLineId, {
          type: 'LineString',
          coordinates: nextCoords,
        });
      };

      const endDrag = () => {
        if (!dragState) return;
        map.dragPan.enable();
        map.off('mousemove', onDragMove);
        map.getCanvas().style.cursor = '';

        const finalGeometry: GeoJSON.LineString = {
          type: 'LineString',
          coordinates: dragState.lastCoords,
        };

        persistCrossLineGeometryRef.current(dragState.crossLineId, finalGeometry);
        dragState = null;
      };

      map.on('mousedown', 'perpendicular-lines-hit-target', (e) => {
        if (!isSelectingCrossLinesRef.current) return;
        if (crossLineControlModeRef.current !== 'free') return;
        if (crossLineEditModeRef.current !== 'select') return;

        const feature = e.features?.[0];
        const crossLineId = feature?.properties?.crossLineId as number | undefined;
        if (crossLineId === undefined || crossLineId === null) return;

        const currentData = perpendicularDataRef.current;
        const currentFeature: any = currentData?.features?.[crossLineId];
        if (!currentFeature || currentFeature.geometry?.type !== 'LineString') return;

        const startCoords = (currentFeature.geometry.coordinates as number[][]) || [];
        if (startCoords.length < 2) return;

        setSelectedCrossLineIndex(crossLineId);

        dragState = {
          crossLineId,
          startLngLat: e.lngLat,
          startCoords: startCoords.map((c) => [c[0], c[1]]),
          lastCoords: startCoords.map((c) => [c[0], c[1]]),
        };

        map.dragPan.disable();
        map.getCanvas().style.cursor = 'move';

        map.on('mousemove', onDragMove);
        map.once('mouseup', endDrag);
      });

      map.on('click', (e) => {
        // 所有编辑操作未激活时：点击断面只展示状态，不进入选择/编辑
        const noEditingActive =
          !isSelectingShoreLinesRef.current &&
          !isSelectingStartEndRef.current &&
          !isSelectingCrossLinesRef.current;

        if (noEditingActive) {
          const crossLineFeatures = map.queryRenderedFeatures(e.point, { layers: crossLineHitLayers });
          const hit = crossLineFeatures?.[0];
          if (hit) {
            openCrossLineInfoPopup(e.lngLat, hit.properties || {});
            return;
          }
        }

        if (isSelectingCrossLinesRef.current) {
          // 进入断面编辑时，关闭信息弹窗，避免遮挡
          closeInfoPopup();
          const editMode = crossLineEditModeRef.current;
          const controlMode = crossLineControlModeRef.current;

          if (editMode === 'none') {
            setSelectedCrossLineIndex(null);
            return;
          }

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
            if (controlMode === 'shoreline') {
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
            } else {
              const clicked = [e.lngLat.lng, e.lngLat.lat] as number[];
              if (!freeAddStartRef.current) {
                freeAddStartRef.current = clicked;
                const source = map.getSource('snap-point') as mapboxgl.GeoJSONSource;
                if (source) source.setData(turf.point(clicked));
                console.log('自由模式：已选择断面起点');
              } else {
                const start = freeAddStartRef.current;
                freeAddStartRef.current = null;
                const source = map.getSource('snap-point') as mapboxgl.GeoJSONSource;
                if (source) source.setData(turf.featureCollection([]));
                console.log('自由模式：已选择断面终点，开始创建断面');
                createCrossLineByEndpointsRef.current(start, clicked);
              }
            }
          }
          return;
        }

        // 点击到空白处时，收起信息弹窗
        closeInfoPopup();

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

      map.on('mouseenter', 'perpendicular-lines-hit-target', () => {
        const noEditingActive =
          !isSelectingShoreLinesRef.current &&
          !isSelectingStartEndRef.current &&
          !isSelectingCrossLinesRef.current;
        if (noEditingActive) {
          map.getCanvas().style.cursor = 'pointer';
        }
      });

      map.on('mouseleave', 'perpendicular-lines-hit-target', () => {
        const noEditingActive =
          !isSelectingShoreLinesRef.current &&
          !isSelectingStartEndRef.current &&
          !isSelectingCrossLinesRef.current;
        if (noEditingActive) {
          map.getCanvas().style.cursor = '';
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
