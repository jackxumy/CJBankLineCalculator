import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import * as turf from '@turf/turf';
import 'mapbox-gl/dist/mapbox-gl.css';
import '../App.css';

// 设置Mapbox访问令牌
mapboxgl.accessToken = 'pk.eyJ1IjoieWNzb2t1IiwiYSI6ImNrenozdWdodDAza3EzY3BtdHh4cm5pangifQ.ZigfygDi2bK4HXY1pWh-wg'

// 断面参数接口（从后端获取）
interface SectionParams {
  param_name?: string;
  segment?: string;
  current_timepoint?: string;
  set_name?: string;
  water_qs?: string;
  tidal_level?: string;
  bench_id?: string;
  ref_id?: string;
  hs?: number;
  hc?: number;
  protection_level?: string;
  control_level?: string;
  comparison_timepoint?: string;
  risk_thresholds?: {
    Dsed?: number[];
    Zb?: number[];
    Sa?: number[];
    Ln?: number[];
    PQ?: number[];
    Ky?: number[];
    Zd?: number[];
    all?: number[];
  };
  weights?: {
    wRE?: number[];
    wNM?: number[];
    wGE?: number[];
    wRL?: number[];
  };
  other_params?: Record<string, any>;
}

/**
 * 在线上以固定间距生成垂线
 * @param line 主线
 * @param startDist 起点距离 (米)
 * @param endDist 终点距离 (米)
 * @param interval 间距 (米)
 * @param crossLength 垂线总长度 (米)
 */
function generatePerpendicularLines(
  line: GeoJSON.Feature<GeoJSON.LineString>,
  startDist: number,
  endDist: number,
  interval: number,
  crossLength: number
) {
  const perpendicularLines: GeoJSON.Feature<GeoJSON.LineString>[] = [];
  const endpointData: { distance: number; left: number[]; right: number[] }[] = [];

  // 确保 start < end
  const actualStart = Math.min(startDist, endDist);
  const actualEnd = Math.max(startDist, endDist);
  const lineLength = turf.length(line, { units: 'meters' });
  const segmentLen = actualEnd - actualStart;

  console.log(`--- 生成垂线数据 (范围: ${actualStart.toFixed(2)}m - ${actualEnd.toFixed(2)}m, 段长: ${segmentLen.toFixed(2)}m, 母线总长: ${lineLength.toFixed(2)}m) ---`);

  for (let d = actualStart; d <= actualEnd; d += interval) {
    const p1 = turf.along(line, d, { units: 'meters' });
    // 为了计算切线方向
    const p2Offset = Math.min(d + 0.1, lineLength);
    const p2 = turf.along(line, p2Offset, { units: 'meters' });

    const relPos = segmentLen > 0 ? (d - actualStart) / segmentLen : 0;
    console.log(`垂线位置: ${d.toFixed(2)}m, 整线归一化: ${(d / lineLength).toFixed(4)}, 区段内归一化: ${relPos.toFixed(4)}`);

    let bearing = 0;
    if (d >= lineLength - 0.1) {
      const pPrev = turf.along(line, Math.max(0, d - 0.1), { units: 'meters' });
      bearing = turf.bearing(pPrev, p1);
    } else {
      bearing = turf.bearing(p1, p2);
    }

    const leftEnd = turf.destination(p1, crossLength / 2, bearing - 90, { units: 'meters' });
    const rightEnd = turf.destination(p1, crossLength / 2, bearing + 90, { units: 'meters' });

    const leftCoords = leftEnd.geometry.coordinates;
    const rightCoords = rightEnd.geometry.coordinates;

    endpointData.push({
      distance: d,
      left: leftCoords,
      right: rightCoords
    });

    perpendicularLines.push({
      type: 'Feature',
      properties: {
        distance: d,
        leftPoint: leftCoords,
        rightPoint: rightCoords
      },
      geometry: {
        type: 'LineString',
        coordinates: [
          leftCoords,
          rightCoords
        ]
      }
    });
  }

  return {
    featureCollection: turf.featureCollection(perpendicularLines),
    endpointData
  };
}

// 定义选择组接口
interface SelectionGroup {
  id: string;
  line: GeoJSON.Feature<GeoJSON.LineString>;
  lineIndex: number | undefined; // 线在上传数据中的索引，用于判断是否同一条线
  start: number;
  end: number | null;
  interval: number;
  // 上一次实际应用到垂线上的间距，用于判断用户是否修改了间距
  lastAppliedInterval: number;
  length: number;
  crossData: { distance: number; left: number[]; right: number[] }[];
  // 该组的属性配置（如果未设置则使用全局配置）
  properties?: SectionParams;
}

// 新增：当前任务ID状态
let currentTaskId: string | null = null;
let currentBasicParamId: number | null = null; // 默认基础参数ID

// 确保默认基础参数存在
const ensureDefaultBasicParams = async (): Promise<number | null> => {
  // 如果已经有缓存的ID，直接返回
  if (currentBasicParamId !== null) {
    return currentBasicParamId;
  }

  try {
    // 先尝试获取现有的基础参数列表
    const listResponse = await fetch('/v0/bank/basic-params');
    if (listResponse.ok) {
      const listData = await listResponse.json();
      if (listData.success && listData.params && listData.params.length > 0) {
        // 使用第一个基础参数
        currentBasicParamId = listData.params[0].id;
        console.log('使用现有基础参数:', currentBasicParamId);
        return currentBasicParamId;
      }
    }

    // 如果没有基础参数，创建一个默认的
    console.log('创建默认基础参数模板...');
    const defaultParams = {
      params: [
        {
          param_id: `PARAM_DEFAULT_${Date.now()}`,
          param_name: '默认参数模板',
          segment: 'Mzs',
          current_timepoint: new Date().toISOString().split('T')[0],
          set_name: 'standard',
          water_qs: '45000',
          tidal_level: 'zc',
          bench_id: 'dem_2024.tif',
          ref_id: 'dem_2020.tif',
          hs: 0.5,
          hc: 2.0,
          protection_level: 'systemic',
          control_level: 'strict',
          comparison_timepoint: '2020-01-15',
          risk_thresholds: {
            Dsed: [0.3, 0.5, 0.7],
            Zb: [2.0, 4.0, 6.0],
            Sa: [15, 25, 35],
            Ln: [0.5, 1.0, 1.5],
            PQ: [1000, 2000, 3000],
            Ky: [0.5, 0.3, 0.1],
            Zd: [0.1, 0.2, 0.3],
            all: [0.2, 0.4, 0.6]
          },
          weights: {
            wRE: [0.3, 0.4, 0.3],
            wNM: [0.4, 0.3, 0.3],
            wGE: [0.4, 0.4, 0.2],
            wRL: [0.3, 0.3, 0.4]
          },
          other_params: {
            note: '系统自动创建的默认参数'
          }
        }
      ],
      overwrite: false
    };

    const createResponse = await fetch('/v0/bank/basic-params', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(defaultParams)
    });

    if (!createResponse.ok) {
      console.error('创建默认基础参数失败:', createResponse.statusText);
      return null;
    }

    const createData = await createResponse.json();
    if (createData.success && createData.params && createData.params.length > 0) {
      currentBasicParamId = createData.params[0].id;
      console.log('默认基础参数创建成功，ID:', currentBasicParamId);
      return currentBasicParamId;
    }

    return null;
  } catch (err) {
    console.error('确保默认基础参数出错:', err);
    return null;
  }
};

// 从后端获取断面参数
const fetchSectionParams = async (sectionId: string): Promise<SectionParams | null> => {
  try {
    const response = await fetch(`/v0/bank/sections/${sectionId}`);
    if (!response.ok) {
      console.error(`获取断面参数失败: ${response.statusText}`);
      return null;
    }
    const data = await response.json();
    if (!data.success || !data.section) {
      console.error('断面数据格式错误');
      return null;
    }
    
    // 提取参数字段
    const params: SectionParams = {
      param_name: data.section.param_name,
      segment: data.section.segment,
      current_timepoint: data.section.current_timepoint,
      set_name: data.section.set_name,
      water_qs: data.section.water_qs,
      tidal_level: data.section.tidal_level,
      bench_id: data.section.bench_id,
      ref_id: data.section.ref_id,
      hs: data.section.hs,
      hc: data.section.hc,
      protection_level: data.section.protection_level,
      control_level: data.section.control_level,
      comparison_timepoint: data.section.comparison_timepoint,
      risk_thresholds: data.section.risk_thresholds,
      weights: data.section.weights,
      other_params: data.section.other_params
    };
    
    return params;
  } catch (err) {
    console.error('获取断面参数出错:', err);
    return null;
  }
};

function EditorPage() {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  // 上传的 GeoJSON 数据 (主线)
  const [uploadedData, setUploadedData] = useState<GeoJSON.FeatureCollection | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  // 生成的垂线数据
  const [perpendicularData, setPerpendicularData] = useState<GeoJSON.FeatureCollection | null>(null);

  // 所有选择组
  const [groups, setGroups] = useState<SelectionGroup[]>([]);
  const groupsRef = useRef(groups);
  useEffect(() => { groupsRef.current = groups; }, [groups]);

  // 全局垂线配置（用于首次绘制整个 GeoJSON）
  const [globalInterval, setGlobalInterval] = useState<number>(100);
  const [globalLength, setGlobalLength] = useState<number>(2000);
  
  // 当前正在编辑的组ID
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  
  const [showCrossLines, setShowCrossLines] = useState<boolean>(true);
  
  // 全局属性配置
  const [globalProperties, setGlobalProperties] = useState<SectionParams | null>(null);
  const globalPropertiesRef = useRef(globalProperties);
  useEffect(() => { globalPropertiesRef.current = globalProperties; }, [globalProperties]);
  // 属性配置弹窗状态
  const [showGlobalPropertiesModal, setShowGlobalPropertiesModal] = useState<boolean>(false);
  const [editingPropertiesGroupId, setEditingPropertiesGroupId] = useState<string | null>(null);
  
  // 新增状态：控制岸段选择模式
  const [isSelectingShoreLines, setIsSelectingShoreLines] = useState<boolean>(false);
  const isSelectingShoreLinesRef = useRef(isSelectingShoreLines);
  useEffect(() => { isSelectingShoreLinesRef.current = isSelectingShoreLines; }, [isSelectingShoreLines]);
  
  // 新增状态：控制起止点选择模式
  const [isSelectingStartEnd, setIsSelectingStartEnd] = useState<boolean>(false);
  const isSelectingStartEndRef = useRef(isSelectingStartEnd);
  useEffect(() => { isSelectingStartEndRef.current = isSelectingStartEnd; }, [isSelectingStartEnd]);
  
  // 新增状态：选中的用于生成垂线的线段（存储线的唯一标识）
  const [selectedLines, setSelectedLines] = useState<Set<string>>(new Set());
  const selectedLinesRef = useRef(selectedLines);
  useEffect(() => { selectedLinesRef.current = selectedLines; }, [selectedLines]);
  
  // 新增状态：控制断面选择模式
  const [isSelectingCrossLines, setIsSelectingCrossLines] = useState<boolean>(false);
  const isSelectingCrossLinesRef = useRef(isSelectingCrossLines);
  useEffect(() => { isSelectingCrossLinesRef.current = isSelectingCrossLines; }, [isSelectingCrossLines]);
  
  // 新增状态：断面编辑模式 ('select' 选择现有断面, 'add' 新建断面)
  const [crossLineEditMode, setCrossLineEditMode] = useState<'select' | 'add'>('select');
  const crossLineEditModeRef = useRef(crossLineEditMode);
  useEffect(() => { crossLineEditModeRef.current = crossLineEditMode; }, [crossLineEditMode]);
  
  // 新增状态：选中的断面索引
  const [selectedCrossLineIndex, setSelectedCrossLineIndex] = useState<number | null>(null);
  const selectedCrossLineIndexRef = useRef(selectedCrossLineIndex);
  useEffect(() => { selectedCrossLineIndexRef.current = selectedCrossLineIndex; }, [selectedCrossLineIndex]);

  // 使用 Ref 跟踪配置值，确保事件监听器中能获取到最新值
  const configRef = useRef({ interval: globalInterval, length: globalLength });
  useEffect(() => {
    configRef.current = { interval: globalInterval, length: globalLength };
  }, [globalInterval, globalLength]);

  // 切换岸段选择模式
  const toggleShoreLineSelection = () => {
    setIsSelectingShoreLines(!isSelectingShoreLines);
    if (isSelectingStartEnd) {
      setIsSelectingStartEnd(false); // 关闭起止点选择模式
    }
    if (isSelectingCrossLines) {
      setIsSelectingCrossLines(false); // 关闭断面选择模式
    }
  };
  
  // 全选所有岸段
  const selectAllShoreLines = () => {
    if (!uploadedData) {
      alert('请先上传 GeoJSON 数据');
      return;
    }
    
    const allLineIds = new Set<string>();
    uploadedData.features.forEach((feature, index) => {
      if (feature.geometry.type === 'LineString' || feature.geometry.type === 'MultiLineString') {
        allLineIds.add(`line-${index}`);
      }
    });
    
    setSelectedLines(allLineIds);
    console.log(`已全选 ${allLineIds.size} 个岸段`);
    alert(`已全选 ${allLineIds.size} 个岸段`);
  };
  
  // 切换起止点选择模式
  const toggleStartEndSelection = () => {
    setIsSelectingStartEnd(!isSelectingStartEnd);
    if (isSelectingShoreLines) {
      setIsSelectingShoreLines(false); // 关闭岸段选择模式
    }
    if (isSelectingCrossLines) {
      setIsSelectingCrossLines(false); // 关闭断面选择模式
    }
  };
  
  // 切换断面选择模式
  const toggleCrossLineSelection = () => {
    setIsSelectingCrossLines(!isSelectingCrossLines);
    if (isSelectingShoreLines) {
      setIsSelectingShoreLines(false);
    }
    if (isSelectingStartEnd) {
      setIsSelectingStartEnd(false);
    }
    if (!isSelectingCrossLines) {
      setSelectedCrossLineIndex(null); // 关闭模式时清空选择
      setCrossLineEditMode('select'); // 重置为选择模式
    }
  };
  
  // 在指定位置新建断面
  const createCrossLineAtPoint = async (line: GeoJSON.Feature<GeoJSON.LineString>, distanceOnLine: number) => {
    if (!currentTaskId) {
      alert('未找到任务ID，请先创建任务');
      return;
    }

    // 确保基础参数存在
    const basicParamId = await ensureDefaultBasicParams();
    if (!basicParamId) {
      alert('获取默认参数失败');
      return;
    }

    // 先根据当前点击位置计算几何信息
    const pointOnLine = turf.along(line, distanceOnLine, { units: 'meters' });
    const lineLength = turf.length(line, { units: 'meters' });
    const nextDist = Math.min(distanceOnLine + 0.1, lineLength);
    const nextPoint = turf.along(line, nextDist, { units: 'meters' });

    let bearing = 0;
    if (distanceOnLine >= lineLength - 0.1) {
      const prevPoint = turf.along(line, Math.max(0, distanceOnLine - 0.1), { units: 'meters' });
      bearing = turf.bearing(prevPoint, pointOnLine);
    } else {
      bearing = turf.bearing(pointOnLine, nextPoint);
    }

    const currentLength = configRef.current.length;
    const leftEnd = turf.destination(pointOnLine, currentLength / 2, bearing - 90, { units: 'meters' });
    const rightEnd = turf.destination(pointOnLine, currentLength / 2, bearing + 90, { units: 'meters' });

    const leftCoords = leftEnd.geometry.coordinates;
    const rightCoords = rightEnd.geometry.coordinates;

    // 所属岸段信息：来自母线的 index 属性
    const parentIndex = (line.properties as any)?.index;
    const parentId = parentIndex !== undefined ? `line-${parentIndex}` : undefined;

    // 构建新断面几何
    const newGeometry: GeoJSON.LineString = {
      type: 'LineString',
      coordinates: [leftCoords, rightCoords]
    };

    try {
      // 先发送到后端创建断面
      const sectionId = `sec-${currentTaskId}-new-${Date.now()}`;
      const newSectionIndex = perpendicularData ? perpendicularData.features.length : 0;

      const sectionsPayload = {
        task_id: currentTaskId,
        sections: [
          {
            section_id: sectionId,
            section_name: `新建断面${newSectionIndex + 1}`,
            distance: distanceOnLine,
            bank_id: parentId || 'line-0',
            region_code: 'Mzs',
            segment_index: newSectionIndex,
            geometry: newGeometry,
            section_geometry: newGeometry,
            basic_param_id: basicParamId
          }
        ],
        inherit_from_basic_param: true,
        overwrite: false
      };

      const response = await fetch('/v0/bank/sections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sectionsPayload)
      });

      if (!response.ok) {
        throw new Error(`创建断面失败: ${response.statusText}`);
      }

      const result = await response.json();
      console.log('断面创建成功:', result);

      // 获取断面参数
      if (result.success && result.sections && result.sections.length > 0) {
        const createdSection = result.sections[0];
        const params = await fetchSectionParams(createdSection.section_id);
        if (params) {
          console.log('获取到断面参数:', params);
          // 如果这是第一个断面，设置为全局参数
          if (!globalPropertiesRef.current) {
            setGlobalProperties(params);
          }
        }
      }

      // 使用函数式更新前端状态
      setPerpendicularData(prev => {
        const existing = prev ? (prev.features as GeoJSON.Feature<GeoJSON.LineString>[]) : [];
        const newCrossLineId = existing.length;

        const newCrossLine: GeoJSON.Feature<GeoJSON.LineString> = {
          type: 'Feature',
          properties: {
            sectionId: sectionId,
            crossLineId: newCrossLineId,
            distance: distanceOnLine,
            shoreLineIndex: parentIndex,
            shoreLineId: parentId,
            leftPoint: leftCoords,
            rightPoint: rightCoords
          },
          geometry: newGeometry
        };

        const newFeatures = [...existing, newCrossLine];
        console.log(`新建断面 #${newCrossLineId + 1}，位置: ${distanceOnLine.toFixed(2)}m，当前总数: ${newFeatures.length}`);
        return turf.featureCollection(newFeatures);
      });
    } catch (err: any) {
      console.error('新建断面失败:', err);
      alert(`新建断面失败: ${err.message}`);
    }
  };
  
  // 删除选中的断面
  const deleteSelectedCrossLine = async () => {
    if (selectedCrossLineIndex === null || !perpendicularData) {
      alert('请先选择要删除的断面');
      return;
    }

    const features = perpendicularData.features as GeoJSON.Feature<GeoJSON.LineString>[];
    const selectedFeature = features[selectedCrossLineIndex];
    const sectionId = selectedFeature.properties?.sectionId;

    if (!sectionId) {
      // 如果没有 sectionId，说明未同步到后端，仅删除前端
      const updatedFeatures = perpendicularData.features.filter((_, index) => index !== selectedCrossLineIndex);
      // 重新分配ID
      updatedFeatures.forEach((feature, index) => {
        if (feature.properties) {
          feature.properties.crossLineId = index;
        }
      });
      setPerpendicularData(turf.featureCollection(updatedFeatures));
      setSelectedCrossLineIndex(null);
      console.log('已删除未同步断面');
      alert('已删除选中的断面');
      return;
    }

    try {
      // 调用后端删除接口
      const response = await fetch(`/v0/bank/sections/${sectionId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error(`删除断面失败: ${response.statusText}`);
      }

      // 删除成功后更新前端
      const updatedFeatures = perpendicularData.features.filter((_, index) => index !== selectedCrossLineIndex);
      // 重新分配ID
      updatedFeatures.forEach((feature, index) => {
        if (feature.properties) {
          feature.properties.crossLineId = index;
        }
      });
      setPerpendicularData(turf.featureCollection(updatedFeatures));
      setSelectedCrossLineIndex(null);
      console.log(`已从后端删除断面: ${sectionId}`);
      alert('已删除选中的断面');
    } catch (err: any) {
      console.error('删除断面失败:', err);
      alert(`删除断面失败: ${err.message}`);
    }
  };
  
  // 平移选中的断面
  const translateSelectedCrossLine = async (offsetMeters: number) => {
    if (selectedCrossLineIndex === null || !perpendicularData) {
      alert('请先选择要平移的断面');
      return;
    }
    
    const selectedLine = perpendicularData.features[selectedCrossLineIndex];
    if (!selectedLine || selectedLine.geometry.type !== 'LineString') return;
    
    const coords = selectedLine.geometry.coordinates as number[][];
    const leftPoint = coords[0];
    const rightPoint = coords[1];
    
    // 计算断面的中点和方向
    const midPoint = turf.point([(leftPoint[0] + rightPoint[0]) / 2, (leftPoint[1] + rightPoint[1]) / 2]);
    const bearing = turf.bearing(turf.point(leftPoint), turf.point(rightPoint));
    
    // 沿着垂直于断面的方向移动（即沿着母线方向）
    const perpendicularBearing = bearing + 90;
    const newMidPoint = turf.destination(midPoint, Math.abs(offsetMeters), offsetMeters > 0 ? perpendicularBearing : perpendicularBearing + 180, { units: 'meters' });
    
    // 计算新的端点
    const halfLength = turf.distance(turf.point(leftPoint), turf.point(rightPoint), { units: 'meters' }) / 2;
    const newLeftPoint = turf.destination(newMidPoint, halfLength, bearing + 180, { units: 'meters' });
    const newRightPoint = turf.destination(newMidPoint, halfLength, bearing, { units: 'meters' });

    const newGeometry: GeoJSON.LineString = {
      type: 'LineString',
      coordinates: [
        newLeftPoint.geometry.coordinates,
        newRightPoint.geometry.coordinates
      ]
    };

    const sectionId = selectedLine.properties?.sectionId;

    if (!sectionId) {
      // 如果没有 sectionId，说明未同步到后端，仅更新前端
      const updatedFeatures = [...perpendicularData.features];
      updatedFeatures[selectedCrossLineIndex] = {
        ...selectedLine,
        geometry: newGeometry,
        properties: {
          ...selectedLine.properties,
          crossLineId: selectedLine.properties?.crossLineId ?? selectedCrossLineIndex,
          leftPoint: newLeftPoint.geometry.coordinates,
          rightPoint: newRightPoint.geometry.coordinates
        }
      };
      setPerpendicularData(turf.featureCollection(updatedFeatures as GeoJSON.Feature<GeoJSON.LineString>[]));
      console.log('已平移未同步断面');
      return;
    }

    try {
      // 调用后端更新断面几何
      const response = await fetch(`/v0/bank/sections/${sectionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          geometry: newGeometry,
          section_geometry: newGeometry
        })
      });

      if (!response.ok) {
        throw new Error(`更新断面几何失败: ${response.statusText}`);
      }

      // 更新成功后更新前端
      const updatedFeatures = [...perpendicularData.features];
      updatedFeatures[selectedCrossLineIndex] = {
        ...selectedLine,
        geometry: newGeometry,
        properties: {
          ...selectedLine.properties,
          crossLineId: selectedLine.properties?.crossLineId ?? selectedCrossLineIndex,
          leftPoint: newLeftPoint.geometry.coordinates,
          rightPoint: newRightPoint.geometry.coordinates
        }
      };
      setPerpendicularData(turf.featureCollection(updatedFeatures as GeoJSON.Feature<GeoJSON.LineString>[]));
      console.log(`已更新后端断面几何: ${sectionId}`);
    } catch (err: any) {
      console.error('平移断面失败:', err);
      alert(`平移断面失败: ${err.message}`);
    }
  };
  
  // 为选中的断面配置属性
  const configureSelectedCrossLineProperties = async () => {
    if (selectedCrossLineIndex === null || !perpendicularData) {
      alert('请先选择要配置的断面');
      return;
    }
    
    const selectedLine = perpendicularData.features[selectedCrossLineIndex];
    const sectionId = (selectedLine.properties as any)?.sectionId;
    
    if (!sectionId) {
      alert('未找到断面ID，请先重新生成断面');
      return;
    }

    try {
      // 从后端获取断面详情（包含参数）
      const response = await fetch(`/v0/bank/sections/${sectionId}`);
      if (!response.ok) {
        throw new Error(`获取断面参数失败: ${response.statusText}`);
      }

      const data = await response.json();
      if (data.success && data.section) {
        // 将后端参数映射到前端格式并打开配置弹窗
        const backendParams = data.section;
        // 存储后端返回的完整参数供弹窗使用
        (selectedLine.properties as any).backendParams = backendParams;
        setEditingPropertiesGroupId(`cross-line-${selectedCrossLineIndex}`);
      }
    } catch (err: any) {
      console.error('获取断面参数失败:', err);
      alert(`获取断面参数失败: ${err.message}`);
    }
  };

  // 核心逻辑：基于上传的 GeoJSON 和全局配置生成所有垂线
  const handleGenerateSections = async () => {
    if (!uploadedData) {
      alert('请先上传 GeoJSON 数据');
      return;
    }

    if (selectedLines.size === 0) {
      alert('请先选择用于分析的岸段');
      return;
    }

    try {
      // 0. 确保默认基础参数存在
      const basicParamId = await ensureDefaultBasicParams();
      if (!basicParamId) {
        alert('初始化默认参数失败，请检查后端连接');
        return;
      }

      // 1. 先创建任务
      const taskName = window.prompt('请输入任务名称：', '岸线分析任务');
      if (!taskName) {
        alert('任务名称不能为空');
        return;
      }

      const taskId = `task-${Date.now()}`;
      currentTaskId = taskId;

      // 收集选中的岸段ID
      const selectedBankIds: string[] = [];
      selectedLines.forEach(lineId => {
        selectedBankIds.push(lineId);
      });

      const taskPayload = {
        tasks: [
          {
            task_id: taskId,
            task_name: taskName,
            bank_ids: selectedBankIds,
            description: `通过前端创建的任务: ${taskName}`
          }
        ],
        overwrite: false
      };

      console.log('创建任务:', taskPayload);
      const taskResponse = await fetch('/v0/bank/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(taskPayload)
      });

      if (!taskResponse.ok) {
        throw new Error(`创建任务失败: ${taskResponse.statusText}`);
      }

      // 2. 生成断面数据
      const allPerpendicularLines: GeoJSON.Feature<GeoJSON.LineString>[] = [];
      const sectionsToCreate: any[] = [];

      uploadedData.features.forEach((feature, index) => {
        const lineId = `line-${index}`;
        
        // 只处理选中的线段
        if (!selectedLines.has(lineId)) {
          return;
        }
        
        if (feature.geometry.type === 'LineString') {
          const line = feature as GeoJSON.Feature<GeoJSON.LineString>;
          const lineLengthMeters = turf.length(line, { units: 'meters' });
          
          const { featureCollection } = generatePerpendicularLines(
            line,
            0,
            lineLengthMeters,
            globalInterval,
            globalLength
          );

          // 标记每条垂线所属的岸段索引
          featureCollection.features.forEach(f => {
            if (!f.properties) f.properties = {};
            (f.properties as any).shoreLineIndex = index;
            (f.properties as any).shoreLineId = lineId;
          });
          
          allPerpendicularLines.push(...(featureCollection.features as GeoJSON.Feature<GeoJSON.LineString>[]));
        } else if (feature.geometry.type === 'MultiLineString') {
          const multiLine = feature.geometry as GeoJSON.MultiLineString;
          multiLine.coordinates.forEach(coords => {
            const line = turf.lineString(coords) as GeoJSON.Feature<GeoJSON.LineString>;
            const lineLengthMeters = turf.length(line, { units: 'meters' });
            
            const { featureCollection } = generatePerpendicularLines(
              line,
              0,
              lineLengthMeters,
              globalInterval,
              globalLength
            );

            // MultiLineString 的各段也归属于同一个岸段索引
            featureCollection.features.forEach(f => {
              if (!f.properties) f.properties = {};
              (f.properties as any).shoreLineIndex = index;
              (f.properties as any).shoreLineId = lineId;
            });
            allPerpendicularLines.push(...(featureCollection.features as GeoJSON.Feature<GeoJSON.LineString>[]));
          });
        }
      });

      // 3. 构建断面数据并发送到后端
      allPerpendicularLines.forEach((line, index) => {
        const props: any = line.properties || {};
        const sectionId = `sec-${taskId}-${index}`;
        
        sectionsToCreate.push({
          section_id: sectionId,
          section_name: `断面${index + 1}`,
          distance: props.distance,
          bank_id: props.shoreLineId || 'line-0',
          region_code: 'Mzs',
          segment_index: index,
          geometry: line.geometry,
          section_geometry: line.geometry,
          basic_param_id: basicParamId
        });

        // 更新前端断面数据结构
        line.properties = {
          sectionId: sectionId,
          crossLineId: index,
          distance: props.distance,
          shoreLineIndex: props.shoreLineIndex,
          shoreLineId: props.shoreLineId,
          leftPoint: props.leftPoint,
          rightPoint: props.rightPoint
        };
      });

      // 发送断面到后端
      const sectionsPayload = {
        task_id: taskId,
        sections: sectionsToCreate,
        inherit_from_basic_param: true,
        overwrite: false
      };

      console.log(`创建 ${sectionsToCreate.length} 个断面...`);
      console.log('发送到后端的数据:', JSON.stringify(sectionsPayload, null, 2));
      const sectionsResponse = await fetch('/v0/bank/sections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sectionsPayload)
      });

      if (!sectionsResponse.ok) {
        const errorText = await sectionsResponse.text();
        console.error('后端错误响应:', errorText);
        throw new Error(`创建断面失败: ${sectionsResponse.statusText} - ${errorText}`);
      }

      const sectionsResult = await sectionsResponse.json();
      console.log('断面创建成功:', sectionsResult);

      // 获取第一个断面的参数作为全局参数
      if (sectionsResult.success && sectionsResult.sections && sectionsResult.sections.length > 0) {
        const firstSection = sectionsResult.sections[0];
        const params = await fetchSectionParams(firstSection.section_id);
        if (params) {
          console.log('获取到断面参数:', params);
          // 设置为全局参数
          setGlobalProperties(params);
        }
      }

      setPerpendicularData(turf.featureCollection(allPerpendicularLines));
      setShowCrossLines(true);
      alert(`任务创建成功！\n已为 ${selectedLines.size} 个岸段生成 ${allPerpendicularLines.length} 条断面！`);
    } catch (err: any) {
      console.error('生成断面失败:', err);
      alert(`生成断面失败: ${err.message}`);
    }
  };

  // 开始分析：运行任务中的所有断面
  const handleStartAnalysis = async () => {
    if (!perpendicularData || perpendicularData.features.length === 0) {
      alert('请先绘制断面');
      return;
    }

    if (!currentTaskId) {
      alert('未找到任务ID，请先绘制断面');
      return;
    }

    try {
      console.log(`开始分析任务: ${currentTaskId}`);
      
      const response = await fetch(`/v0/bank/tasks/${currentTaskId}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        throw new Error(`运行任务失败: ${response.statusText}`);
      }

      const result = await response.json();
      console.log('任务运行结果:', result);
      
      if (result.success) {
        alert(`任务运行成功！\n状态: ${result.status}\n已处理 ${result.results?.length || 0} 个断面`);
      } else {
        alert('任务运行失败，请检查控制台');
      }
    } catch (err: any) {
      console.error('运行任务失败:', err);
      alert(`运行任务失败: ${err.message}`);
    }
  };

  // 应用自定义线段配置：更新当前编辑组的垂线
  const handleApplyCustomSegments = () => {
    if (!editingGroupId) {
      alert('请先点击编辑按钮选择要修改的组');
      return;
    }

    const editingGroup = groups.find(g => g.id === editingGroupId);
    if (!editingGroup || editingGroup.end === null) {
      alert('选择的组未完成起止点选择');
      return;
    }

    if (!perpendicularData) {
      alert('请先绘制断面');
      return;
    }

    const start = Math.min(editingGroup.start, editingGroup.end);
    const end = Math.max(editingGroup.start, editingGroup.end);
    
    // 判断是否修改了间距：如果当前间距与上一次应用的间距不同，则认为修改了间距
    const intervalChanged = editingGroup.interval !== editingGroup.lastAppliedInterval;

    // 复制现有垂线数据
    let updatedLines = [...perpendicularData.features] as GeoJSON.Feature<GeoJSON.LineString>[];

    if (!intervalChanged) {
      // ✅ 未修改间距：仅根据每条垂线的位置，调整其长度，不改变位置与数量
      const newCrossData: { distance: number; left: number[]; right: number[] }[] = [];

      updatedLines = updatedLines.map(line => {
        const lineProp: any = line.properties || {};
        const leftPoint = lineProp.leftPoint as number[] | undefined;
        const rightPoint = lineProp.rightPoint as number[] | undefined;
        if (!leftPoint || !rightPoint) return line;

        try {
          // 垂线中点
          const mid = [(leftPoint[0] + rightPoint[0]) / 2, (leftPoint[1] + rightPoint[1]) / 2];
          const midPoint = turf.point(mid);
          // 投影到当前组的主线上，得到该垂线在主线上的实际距离
          const snapped = turf.nearestPointOnLine(editingGroup.line, midPoint, { units: 'meters' });
          const actualDist = snapped.properties.location ?? 0;
          const distToLine = turf.distance(midPoint, snapped, { units: 'meters' });

          // 过滤：只处理同一条线、并且距离在线段 [start, end] 内的垂线
          if (distToLine > Math.max(globalLength, editingGroup.length) / 2 + 100) {
            return line;
          }
          if (actualDist < start || actualDist > end) {
            return line;
          }

          // 以投影点为中心点，按旧的朝向，重新根据新的长度计算端点
          const centerPoint = snapped as GeoJSON.Feature<GeoJSON.Point>;
          const bearingToLeft = turf.bearing(centerPoint, turf.point(leftPoint));
          const halfLen = editingGroup.length / 2;

          const leftEnd = turf.destination(centerPoint, halfLen, bearingToLeft, { units: 'meters' });
          const rightEnd = turf.destination(centerPoint, halfLen, bearingToLeft + 180, { units: 'meters' });

          const newLeft = leftEnd.geometry.coordinates as number[];
          const newRight = rightEnd.geometry.coordinates as number[];

          line.geometry = {
            type: 'LineString',
            coordinates: [newLeft, newRight]
          };
          // 简化属性结构，保留原ID
          line.properties = {
            crossLineId: lineProp.crossLineId,
            distance: lineProp.distance,
            shoreLineIndex: lineProp.shoreLineIndex,
            shoreLineId: lineProp.shoreLineId,
            leftPoint: newLeft,
            rightPoint: newRight,
            analysisConfig: editingGroup.properties || { ...globalProperties }
          };

          newCrossData.push({ distance: actualDist, left: newLeft, right: newRight });

          return line;
        } catch {
          return line;
        }
      });

      // 按距离排序 crossData，方便后续使用
      newCrossData.sort((a, b) => a.distance - b.distance);

      setGroups(prev => {
        const updated = [...prev];
        const idx = updated.findIndex(g => g.id === editingGroup.id);
        if (idx !== -1) {
          updated[idx] = {
            ...editingGroup,
            crossData: newCrossData,
            lastAppliedInterval: editingGroup.interval
          };
        }
        return updated;
      });

      setPerpendicularData(turf.featureCollection(updatedLines));
      alert(`已更新组 ${groups.findIndex(g => g.id === editingGroupId) + 1} 的垂线长度（未修改间距）`);
    } else {
      // ✅ 修改了间距：删除该段原有垂线，根据新的间距与长度重新生成

      // 移除该线段范围内的旧垂线（只移除同一条线上的）
      updatedLines = updatedLines.filter(line => {
        const lineProp = line.properties as any;
        if (!lineProp) return true;
        
        const leftPoint = lineProp.leftPoint as number[] | undefined;
        const rightPoint = lineProp.rightPoint as number[] | undefined;
        if (!leftPoint || !rightPoint) return true;
        
        try {
          const midPoint = turf.point([(leftPoint[0] + rightPoint[0]) / 2, (leftPoint[1] + rightPoint[1]) / 2]);
          const distOnLine = turf.nearestPointOnLine(editingGroup.line, midPoint, { units: 'meters' });
          const actualDist = distOnLine.properties.location ?? 0;
          
          // 检查垂线中点是否真的在当前线上（通过距离阈值判断）
          const distToLine = turf.distance(midPoint, distOnLine, { units: 'meters' });
          
          // 如果垂线中点距离线太远，说明不是同一条线
          if (distToLine > Math.max(globalLength, editingGroup.length) / 2 + 100) {
            return true; // 保留，不是同一条线
          }
          
          // 是同一条线，检查是否在选择范围内
          if (actualDist >= start && actualDist <= end) {
            return false; // 移除，在范围内
          }
          
          return true; // 保留，不在范围内
        } catch {
          return true; // 出错则保留
        }
      });
      
      // 生成新的垂线数据
      const { featureCollection, endpointData } = generatePerpendicularLines(
        editingGroup.line,
        start,
        end,
        editingGroup.interval,
        editingGroup.length
      );
      
      // 简化垂线属性结构，添加新ID
      const startId = updatedLines.length;
      featureCollection.features.forEach((line, idx) => {
        const props: any = line.properties || {};
        const leftPoint = props.leftPoint;
        const rightPoint = props.rightPoint;
        line.properties = {
          crossLineId: startId + idx,
          distance: props.distance,
          shoreLineIndex: editingGroup.lineIndex,
          shoreLineId: editingGroup.lineIndex !== undefined ? `line-${editingGroup.lineIndex}` : undefined,
          leftPoint: leftPoint,
          rightPoint: rightPoint,
          analysisConfig: editingGroup.properties || { ...globalProperties }
        };
      });
      
      // 更新组的 crossData 与 lastAppliedInterval
      setGroups(prev => {
        const updated = [...prev];
        const idx = updated.findIndex(g => g.id === editingGroup.id);
        if (idx !== -1) {
          updated[idx] = {
            ...editingGroup,
            crossData: endpointData,
            lastAppliedInterval: editingGroup.interval
          };
        }
        return updated;
      });
      
      // 合并新垂线
      updatedLines.push(...(featureCollection.features as GeoJSON.Feature<GeoJSON.LineString>[]));

      setPerpendicularData(turf.featureCollection(updatedLines));
      alert(`已应用组 ${groups.findIndex(g => g.id === editingGroupId) + 1} 的自定义配置（修改了间距，已重绘）`);
    }
  };

  // 处理文件上传
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 记录上传文件名，供任务使用
    setUploadedFileName(file.name);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        const geojson = json.type === 'FeatureCollection' ? json : turf.featureCollection([json]);
        
        // 为每个要素添加索引属性
        geojson.features.forEach((feature: any, index: number) => {
          if (!feature.properties) {
            feature.properties = {};
          }
          feature.properties.index = index;
        });
        
        setUploadedData(geojson);
        // 重置选择状态
        setSelectedLines(new Set());
        setIsSelectingShoreLines(false);
        setIsSelectingStartEnd(false);

        // 异步将 GeoJSON 发送到后端
        fetch('/v0/mi/geojson', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: file.name,
            data: geojson
          })
        }).then(res => {
          if (!res.ok) {
            console.error('上传 GeoJSON 到后端失败:', res.status, res.statusText);
          } else {
            console.log('GeoJSON 已发送到后端');
          }
        }).catch(err => {
          console.error('上传 GeoJSON 到后端出错:', err);
        });

        if (mapRef.current && geojson.features.length > 0) {
          const bbox = turf.bbox(geojson);
          mapRef.current.fitBounds([bbox[0], bbox[1], bbox[2], bbox[3]], { padding: 50 });
        }
      } catch (err) {
        alert('解析 GeoJSON 失败，请检查文件格式');
      }
    };
    reader.readAsText(file);
  };

  // 核心逻辑：同步垂线到地图数据源
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

  // 同步上传的数据到地图
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !uploadedData) return;

    const updateSource = () => {
      const source = map.getSource('uploaded-data') as mapboxgl.GeoJSONSource;
      if (source) {
        source.setData(uploadedData);
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
      // 创建一个新的图层来高亮选中的线段
      const selectedSource = map.getSource('selected-shore-lines') as mapboxgl.GeoJSONSource;
      if (selectedSource) {
        const selectedFeatures = uploadedData.features.filter((_, index) => 
          selectedLines.has(`line-${index}`)
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
      // 更新标记点数据源 (所有起止点)
      const pointSource = map.getSource('selection-points') as mapboxgl.GeoJSONSource;
      if (pointSource) {
        const allPoints: GeoJSON.Feature<GeoJSON.Point>[] = [];
        groups.forEach(group => {
          if (group.start !== null) {
            allPoints.push(turf.along(group.line, group.start, { units: 'meters' }) as GeoJSON.Feature<GeoJSON.Point>);
          }
          if (group.end !== null) {
            allPoints.push(turf.along(group.line, group.end, { units: 'meters' }) as GeoJSON.Feature<GeoJSON.Point>);
          }
        });
        pointSource.setData(turf.featureCollection(allPoints));
      }

      // 更新主线高亮段
      const activeLineSource = map.getSource('active-line') as mapboxgl.GeoJSONSource;
      if (activeLineSource) {
        const segments: GeoJSON.Feature<GeoJSON.LineString>[] = [];
        groups.forEach(group => {
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

  // 控制垂线图层显影
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (map.getLayer('perpendicular-lines-layer')) {
      map.setLayoutProperty(
        'perpendicular-lines-layer',
        'visibility',
        showCrossLines ? 'visible' : 'none'
      );
    }
    if (map.getLayer('perpendicular-lines-hit-target')) {
      map.setLayoutProperty(
        'perpendicular-lines-hit-target',
        'visibility',
        showCrossLines ? 'visible' : 'none'
      );
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

  useEffect(() => {
    if (!mapContainer.current) return;

    // 初始化地图
    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/light-v10',
      center: [119.89600633, 32.22907004],
      zoom: 7,
    });

    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl(), 'top-right');

    map.on('load', () => {
      // 初始化数据源
      map.addSource('perpendicular-lines', { type: 'geojson', data: turf.featureCollection([]) });
      map.addSource('uploaded-data', { type: 'geojson', data: turf.featureCollection([]) });
      map.addSource('selection-points', { type: 'geojson', data: turf.featureCollection([]) });
      map.addSource('snap-point', { type: 'geojson', data: turf.featureCollection([]) });
      map.addSource('active-line', { type: 'geojson', data: turf.featureCollection([]), lineMetrics: true });
      map.addSource('selected-shore-lines', { type: 'geojson', data: turf.featureCollection([]) });

      // 上传线的点击捕获层（透明但宽，便于点击）
      map.addLayer({
        id: 'uploaded-lines-hit-target',
        type: 'line',
        source: 'uploaded-data',
        filter: ['==', '$type', 'LineString'],
        paint: {
          'line-width': 30,
          'line-opacity': 0
        }
      });

      // 上传线的基础显示层
      map.addLayer({
        id: 'uploaded-lines',
        type: 'line',
        source: 'uploaded-data',
        filter: ['==', '$type', 'LineString'],
        paint: {
          'line-color': '#94a3b8',
          'line-width': 2
        }
      });

      // 高亮选中的岸段
      map.addLayer({
        id: 'selected-shore-lines-layer',
        type: 'line',
        source: 'selected-shore-lines',
        filter: ['==', '$type', 'LineString'],
        paint: {
          'line-color': '#f59e0b',
          'line-width': 4
        }
      });

      // 高亮选中的线段
      map.addLayer({
        id: 'active-line-layer',
        type: 'line',
        source: 'active-line',
        paint: {
          'line-color': '#10b981',
          'line-width': 6
        }
      });

      // 断面点击捕获层（透明但宽）
      map.addLayer({
        id: 'perpendicular-lines-hit-target',
        type: 'line',
        source: 'perpendicular-lines',
        paint: {
          'line-width': 20,
          'line-opacity': 0
        }
      });
      
      // 断面显示层
      map.addLayer({
        id: 'perpendicular-lines-layer',
        type: 'line',
        source: 'perpendicular-lines',
        paint: { 'line-color': '#ef4444', 'line-width': 2 }
      });
      
      // 选中断面高亮层
      map.addSource('selected-cross-line', { type: 'geojson', data: turf.featureCollection([]) });
      map.addLayer({
        id: 'selected-cross-line-layer',
        type: 'line',
        source: 'selected-cross-line',
        paint: { 'line-color': '#3b82f6', 'line-width': 4 }
      });

      // 起止点标记
      map.addLayer({
        id: 'points-layer',
        type: 'circle',
        source: 'selection-points',
        paint: {
          'circle-radius': 8,
          'circle-color': '#3b82f6',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff'
        }
      });

      // 渲染吸附点（鼠标靠近线时的反馈）
      map.addLayer({
        id: 'snap-point-layer',
        type: 'circle',
        source: 'snap-point',
        paint: {
          'circle-radius': 5,
          'circle-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#3b82f6'
        }
      });

      const hitLayers = ['uploaded-lines-hit-target'];
      const crossLineHitLayers = ['perpendicular-lines-hit-target'];

      // 点击事件处理
      map.on('click', (e) => {
        // 模式3：断面编辑模式
        if (isSelectingCrossLinesRef.current) {
          const editMode = crossLineEditModeRef.current;
          
          if (editMode === 'select') {
            // 选择现有断面
            const crossLineFeatures = map.queryRenderedFeatures(e.point, { layers: crossLineHitLayers });
            console.log(`点击断面，查询到 ${crossLineFeatures?.length || 0} 个要素`);
            
            if (crossLineFeatures && crossLineFeatures.length > 0) {
              const clickedFeature = crossLineFeatures[0];
              const crossLineId = clickedFeature.properties?.crossLineId;
              
              console.log(`点击的断面ID: ${crossLineId}`);
              
              if (crossLineId !== undefined && crossLineId !== null) {
                setSelectedCrossLineIndex(crossLineId);
                console.log(`选中断面索引: ${crossLineId}`);
              } else {
                console.warn('断面没有crossLineId属性，尝试坐标匹配');
                // 备用方案：使用坐标匹配
                if (perpendicularData) {
                  const clickedGeometry = clickedFeature.geometry as GeoJSON.LineString;
                  const clickedCoords = clickedGeometry.coordinates;
                  
                  const index = perpendicularData.features.findIndex(feature => {
                    if (feature.geometry.type !== 'LineString') return false;
                    const coords = feature.geometry.coordinates;
                    const tolerance = 0.00001;
                    return Math.abs(coords[0][0] - clickedCoords[0][0]) < tolerance && 
                           Math.abs(coords[0][1] - clickedCoords[0][1]) < tolerance &&
                           Math.abs(coords[1][0] - clickedCoords[1][0]) < tolerance && 
                           Math.abs(coords[1][1] - clickedCoords[1][1]) < tolerance;
                  });
                  
                  if (index !== -1) {
                    setSelectedCrossLineIndex(index);
                    console.log(`通过坐标匹配选中断面索引: ${index}`);
                  } else {
                    console.warn('无法通过坐标匹配找到断面');
                  }
                }
              }
            }
          } else if (editMode === 'add') {
            // 新建断面：点击岸段上的点
            const shoreLineFeatures = map.queryRenderedFeatures(e.point, { layers: hitLayers });
            
            if (shoreLineFeatures && shoreLineFeatures.length > 0) {
              const clickedFeature = shoreLineFeatures[0];
              const lineGeo = clickedFeature.geometry as GeoJSON.LineString;
              const lineFeature = turf.feature(lineGeo, clickedFeature.properties) as GeoJSON.Feature<GeoJSON.LineString>;
              
              // 计算点击位置在线上的距离
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

        // 构建当前点击的线要素
        const lineGeo = feature.geometry as GeoJSON.LineString;
        const lineFeature = turf.feature(lineGeo, feature.properties) as GeoJSON.Feature<GeoJSON.LineString>;
        
        // 获取线的索引作为唯一标识
        const lineIndex = feature.properties?.index;
        const lineId = lineIndex !== undefined ? `line-${lineIndex}` : `line-${Math.random()}`;

        // 模式1：选择岸段模式
        if (isSelectingShoreLinesRef.current) {
          setSelectedLines(prev => {
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
        
        // 模式2：选择起止点模式
        if (!isSelectingStartEndRef.current) {
          return; // 如果未开启起止点选择模式，不处理
        }

        const snapped = turf.nearestPointOnLine(lineFeature, [e.lngLat.lng, e.lngLat.lat], { units: 'meters' });
        const dist = snapped.properties.location ?? 0;
        const totalLineLength = turf.length(lineFeature, { units: 'meters' });

        const currentGroups = groupsRef.current;
        const activeIndex = currentGroups.findIndex(g => g.end === null);
        const { interval, length } = configRef.current;

        if (activeIndex === -1) {
          // 创建新组
          console.log(`[设置起点] 线索引: ${lineIndex}, 距离: ${dist.toFixed(2)}m, 整线归一化: ${(dist / totalLineLength).toFixed(4)}`);
          const newGroup: SelectionGroup = {
            id: Math.random().toString(36).substr(2, 9),
            line: lineFeature,
            lineIndex: lineIndex,
            start: dist,
            end: null,
            interval: interval,
            lastAppliedInterval: interval,
            length: length,
            crossData: []
          };
          setGroups(prev => [...prev, newGroup]);
        } else {
          // 检查正在进行的组是否在同一条线上（通过lineIndex判断）
          const activeGroup = currentGroups[activeIndex];
          const isSameLine = lineIndex !== undefined && lineIndex === activeGroup.lineIndex;

          if (isSameLine) {
            // 在同一条线上，结束该组（不立即生成垂线）
            console.log(`[设置终点] 线索引: ${lineIndex}, 距离: ${dist.toFixed(2)}m, 整线归一化: ${(dist / totalLineLength).toFixed(4)}`);
            
            setGroups(prev => {
              const updated = [...prev];
              const idx = updated.findIndex(g => g.id === activeGroup.id);
              if (idx !== -1) {
                updated[idx] = { ...activeGroup, end: dist };
              }
              return updated;
            });
          } else {
            // 在不同线上，重置起点
            console.log(`[跨线点击] 从线${activeGroup.lineIndex}跳到线${lineIndex}，重置起点: ${dist.toFixed(2)}m`);
            
            const newGroup: SelectionGroup = {
              id: Math.random().toString(36).substr(2, 9),
              line: lineFeature,
              lineIndex: lineIndex,
              start: dist,
              end: null,
              interval: interval,
              lastAppliedInterval: interval,
              length: length,
              crossData: []
            };
            
            setGroups(prev => {
              const filtered = prev.filter(g => g.end !== null);
              return [...filtered, newGroup];
            });
          }
        }
      });

      // 断面鼠标悬停效果
      map.on('mousemove', crossLineHitLayers, (e) => {
        if (isSelectingCrossLinesRef.current && crossLineEditModeRef.current === 'select') {
          map.getCanvas().style.cursor = 'pointer';
          
          // 显示断面中点作为视觉反馈
          const features = e.features;
          if (features && features.length > 0) {
            const feature = features[0];
            const geometry = feature.geometry as GeoJSON.LineString;
            const coords = geometry.coordinates;
            
            // 计算中点
            const midPoint = turf.point([
              (coords[0][0] + coords[1][0]) / 2,
              (coords[0][1] + coords[1][1]) / 2
            ]);
            
            const source = map.getSource('snap-point') as mapboxgl.GeoJSONSource;
            if (source) source.setData(midPoint);
          }
        }
      });
      
      // 新建模式下，在岸段上显示吸附点
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
        
        // 只在选择岸段或选择起止点模式下显示吸附效果
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

      // 鼠标离开捕获区域：清空吸附点
      map.on('mouseleave', hitLayers, () => {
        const source = map.getSource('snap-point') as mapboxgl.GeoJSONSource;
        if (source) source.setData(turf.featureCollection([]));

        map.getCanvas().style.cursor = '';
      });
      
      // 断面鼠标悬停效果
      map.on('mousemove', crossLineHitLayers, (e) => {
        if (isSelectingCrossLinesRef.current) {
          map.getCanvas().style.cursor = 'pointer';
          
          // 显示断面中点作为视觉反馈
          const features = e.features;
          if (features && features.length > 0) {
            const feature = features[0];
            const geometry = feature.geometry as GeoJSON.LineString;
            const coords = geometry.coordinates;
            
            // 计算中点
            const midPoint = turf.point([
              (coords[0][0] + coords[1][0]) / 2,
              (coords[0][1] + coords[1][1]) / 2
            ]);
            
            const source = map.getSource('snap-point') as mapboxgl.GeoJSONSource;
            if (source) source.setData(midPoint);
          }
        }
      });
      
      map.on('mouseleave', crossLineHitLayers, () => {
        if (isSelectingCrossLinesRef.current) {
          map.getCanvas().style.cursor = '';
          
          // 清除断面中点
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

  // 清除所有组
  const onClear = () => {
    setGroups([]);
    setPerpendicularData(null);
    setEditingGroupId(null);
    alert('已清除所有选择');
  };

  // 删除单个组
  const deleteGroup = (id: string) => {
    setGroups(prev => prev.filter(g => g.id !== id));
    if (editingGroupId === id) {
      setEditingGroupId(null);
    }
  };

  // 切换编辑组状态
  const handleEditGroup = (id: string) => {
    if (editingGroupId === id) {
      setEditingGroupId(null); // 关闭编辑
    } else {
      setEditingGroupId(id); // 打开编辑
    }
  };

  // 更新组的配置
  const updateGroupConfig = (id: string, field: 'interval' | 'length', value: number) => {
    setGroups(prev => {
      const updated = [...prev];
      const idx = updated.findIndex(g => g.id === id);
      if (idx !== -1) {
        updated[idx] = { ...updated[idx], [field]: value };
      }
      return updated;
    });
  };



  const totalCrossLinesCount = perpendicularData?.features.length || 0;
  const totalSelectedSegments = groups.filter(g => g.end !== null).length;

  // 属性配置弹窗组件
  const PropertiesModal = ({ 
    config, 
    onSave, 
    onClose,
    title,
    sectionId
  }: { 
    config: SectionParams | null; 
    onSave: (newConfig: SectionParams) => void;
    onClose: () => void;
    title: string;
    sectionId?: string;
  }) => {
    const [params, setParams] = useState<SectionParams>(config || {});
    const [isSaving, setIsSaving] = useState(false);

    const handleSave = async () => {
      setIsSaving(true);
      try {
        // 如果有sectionId，调用PUT接口更新后端
        if (sectionId) {
          const response = await fetch(`/v0/bank/sections/${sectionId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params)
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`更新断面参数失败: ${response.statusText} - ${errorText}`);
          }

          console.log('断面参数更新成功');
        }

        // 更新前端状态
        onSave(params);
        onClose();
      } catch (err: any) {
        console.error('保存参数失败:', err);
        alert(`保存失败: ${err.message}`);
      } finally {
        setIsSaving(false);
      }
    };

    return (
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000
      }}>
        <div style={{
          backgroundColor: 'white',
          padding: '20px',
          borderRadius: '8px',
          maxWidth: '800px',
          maxHeight: '80vh',
          overflow: 'auto',
          boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
        }}>
          <h3 style={{ marginTop: 0 }}>{title}</h3>
          
          {/* 基础信息 */}
          <fieldset style={{ marginBottom: '15px', padding: '10px', borderRadius: '4px' }}>
            <legend style={{ fontWeight: 'bold' }}>基础信息</legend>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px' }}>参数名称:</label>
                <input
                  type="text"
                  value={params.param_name || ''}
                  onChange={(e) => setParams({...params, param_name: e.target.value})}
                  style={{ width: '100%', padding: '5px' }}
                />
              </div>
              
              <div>
                <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px' }}>河段编码:</label>
                <input
                  type="text"
                  value={params.segment || ''}
                  onChange={(e) => setParams({...params, segment: e.target.value})}
                  style={{ width: '100%', padding: '5px' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px' }}>当前时间点:</label>
                <input
                  type="text"
                  value={params.current_timepoint || ''}
                  onChange={(e) => setParams({...params, current_timepoint: e.target.value})}
                  placeholder="YYYY-MM-DD"
                  style={{ width: '100%', padding: '5px' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px' }}>对比时间点:</label>
                <input
                  type="text"
                  value={params.comparison_timepoint || ''}
                  onChange={(e) => setParams({...params, comparison_timepoint: e.target.value})}
                  placeholder="YYYY-MM-DD"
                  style={{ width: '100%', padding: '5px' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px' }}>数据集名称:</label>
                <input
                  type="text"
                  value={params.set_name || ''}
                  onChange={(e) => setParams({...params, set_name: e.target.value})}
                  style={{ width: '100%', padding: '5px' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px' }}>流量:</label>
                <input
                  type="text"
                  value={params.water_qs || ''}
                  onChange={(e) => setParams({...params, water_qs: e.target.value})}
                  style={{ width: '100%', padding: '5px' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px' }}>潮位:</label>
                <select
                  value={params.tidal_level || ''}
                  onChange={(e) => setParams({...params, tidal_level: e.target.value})}
                  style={{ width: '100%', padding: '5px' }}
                >
                  <option value="">请选择</option>
                  <option value="xc">小潮</option>
                  <option value="zc">中潮</option>
                  <option value="dc">大潮</option>
                </select>
              </div>
            </div>
          </fieldset>

          {/* DEM参数 */}
          <fieldset style={{ marginBottom: '15px', padding: '10px', borderRadius: '4px' }}>
            <legend style={{ fontWeight: 'bold' }}>DEM参数</legend>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px' }}>基准DEM (bench_id):</label>
                <input
                  type="text"
                  value={params.bench_id || ''}
                  onChange={(e) => setParams({...params, bench_id: e.target.value})}
                  style={{ width: '100%', padding: '5px' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px' }}>参考DEM (ref_id):</label>
                <input
                  type="text"
                  value={params.ref_id || ''}
                  onChange={(e) => setParams({...params, ref_id: e.target.value})}
                  style={{ width: '100%', padding: '5px' }}
                />
              </div>
            </div>
          </fieldset>

          {/* 水深参数 */}
          <fieldset style={{ marginBottom: '15px', padding: '10px', borderRadius: '4px' }}>
            <legend style={{ fontWeight: 'bold' }}>水深参数</legend>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px' }}>hs:</label>
                <input
                  type="number"
                  step="0.1"
                  value={params.hs || ''}
                  onChange={(e) => setParams({...params, hs: Number(e.target.value)})}
                  style={{ width: '100%', padding: '5px' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px' }}>hc:</label>
                <input
                  type="number"
                  step="0.1"
                  value={params.hc || ''}
                  onChange={(e) => setParams({...params, hc: Number(e.target.value)})}
                  style={{ width: '100%', padding: '5px' }}
                />
              </div>
            </div>
          </fieldset>

          {/* 防护控制参数 */}
          <fieldset style={{ marginBottom: '15px', padding: '10px', borderRadius: '4px' }}>
            <legend style={{ fontWeight: 'bold' }}>防护控制参数</legend>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px' }}>防护等级:</label>
                <select
                  value={params.protection_level || ''}
                  onChange={(e) => setParams({...params, protection_level: e.target.value})}
                  style={{ width: '100%', padding: '5px' }}
                >
                  <option value="">请选择</option>
                  <option value="systemic">系统防护</option>
                  <option value="normal">常规防护</option>
                  <option value="low">低防护</option>
                  <option value="no">无防护</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px' }}>控制等级:</label>
                <select
                  value={params.control_level || ''}
                  onChange={(e) => setParams({...params, control_level: e.target.value})}
                  style={{ width: '100%', padding: '5px' }}
                >
                  <option value="">请选择</option>
                  <option value="strict">严格控制</option>
                  <option value="normal">常规控制</option>
                  <option value="low">低控制</option>
                  <option value="no">无控制</option>
                </select>
              </div>
            </div>
          </fieldset>

          {/* 风险阈值 */}
          <fieldset style={{ marginBottom: '15px', padding: '10px', borderRadius: '4px' }}>
            <legend style={{ fontWeight: 'bold' }}>风险阈值 (JSON格式)</legend>
            <textarea
              value={JSON.stringify(params.risk_thresholds || {}, null, 2)}
              onChange={(e) => {
                try {
                  const parsed = JSON.parse(e.target.value);
                  setParams({...params, risk_thresholds: parsed});
                } catch (err) {
                  // 用户正在编辑，暂不更新
                }
              }}
              rows={8}
              style={{ width: '100%', padding: '5px', fontFamily: 'monospace', fontSize: '12px' }}
            />
            <small style={{ color: '#666' }}>
              示例: {`{"Dsed": [0.3, 0.5, 0.7], "Zb": [2.0, 4.0, 6.0], ...}`}
            </small>
          </fieldset>

          {/* 权重参数 */}
          <fieldset style={{ marginBottom: '15px', padding: '10px', borderRadius: '4px' }}>
            <legend style={{ fontWeight: 'bold' }}>权重参数 (JSON格式)</legend>
            <textarea
              value={JSON.stringify(params.weights || {}, null, 2)}
              onChange={(e) => {
                try {
                  const parsed = JSON.parse(e.target.value);
                  setParams({...params, weights: parsed});
                } catch (err) {
                  // 用户正在编辑，暂不更新
                }
              }}
              rows={5}
              style={{ width: '100%', padding: '5px', fontFamily: 'monospace', fontSize: '12px' }}
            />
            <small style={{ color: '#666' }}>
              示例: {`{"wRE": [0.3, 0.4, 0.3], "wNM": [0.4, 0.3, 0.3], ...}`}
            </small>
          </fieldset>

          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button 
              onClick={onClose}
              disabled={isSaving}
              style={{ 
                padding: '8px 16px', 
                cursor: isSaving ? 'not-allowed' : 'pointer',
                opacity: isSaving ? 0.6 : 1
              }}
            >
              取消
            </button>
            <button 
              onClick={handleSave}
              disabled={isSaving}
              style={{ 
                padding: '8px 16px', 
                backgroundColor: '#3b82f6', 
                color: 'white', 
                border: 'none',
                borderRadius: '4px',
                cursor: isSaving ? 'not-allowed' : 'pointer',
                opacity: isSaving ? 0.6 : 1
              }}
            >
              {isSaving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="map-wrapper">
      <div ref={mapContainer} className="map-full" />
      <div className="upload-control">
        <label className="upload-button">
          上传 GeoJSON
          <input
            type="file"
            accept=".geojson,application/json"
            onChange={handleFileUpload}
            style={{ display: 'none' }}
          />
        </label>
        {uploadedData && (
          <div className="upload-info">
            已加载 {uploadedData.features.length} 个要素
            <br />
            已选线段: {totalSelectedSegments} | 垂线总数: {totalCrossLinesCount}
          </div>
        )}
        
        <div className="config-section">
          <h4>1️⃣ 全局垂线配置</h4>
          <div className="config-item">
            <label>垂线间距 (m):</label>
            <input
              type="number"
              value={globalInterval}
              onChange={(e) => setGlobalInterval(Number(e.target.value))}
              min="10"
              step="10"
            />
          </div>
          <div className="config-item">
            <label>垂线总长 (m):</label>
            <input
              type="number"
              value={globalLength}
              onChange={(e) => setGlobalLength(Number(e.target.value))}
              min="100"
              step="100"
            />
          </div>
          <div style={{marginTop: '10px', marginBottom: '10px'}}>
            <button 
              className={`toggle-button ${isSelectingShoreLines ? 'active' : ''}`}
              onClick={toggleShoreLineSelection}
              style={{marginRight: '5px'}}
            >
              {isSelectingShoreLines ? '✅ 正在选择岸段' : '🎯 选择岸段'}
            </button>
            <button 
              className="generate-button"
              onClick={selectAllShoreLines}
              style={{marginRight: '5px'}}
            >
              ✔️ 全选岸段
            </button>
          </div>
          <p style={{fontSize: '13px', color: '#64748b', margin: '5px 0'}}>
            已选择 {selectedLines.size} 个岸段
            {isSelectingShoreLines && ' (点击地图上的线选择/取消选择)'}
          </p>
          <button className="generate-button" onClick={handleGenerateSections}>📏 绘制断面</button>
          {perpendicularData && perpendicularData.features.length > 0 && (
            <button 
              className="generate-button" 
              onClick={() => setShowGlobalPropertiesModal(true)}
              style={{ marginTop: '10px', backgroundColor: '#8b5cf6' }}
            >
              ⚙️ 属性配置
            </button>
          )}
        </div>

        <div className="config-section">
          <h4>2️⃣ 选择起止点（在地图上点击）</h4>
          <button 
            className={`toggle-button ${isSelectingStartEnd ? 'active' : ''}`}
            onClick={toggleStartEndSelection}
            style={{marginBottom: '10px'}}
          >
            {isSelectingStartEnd ? '✅ 起止点选择已开启' : '📍 开启起止点选择'}
          </button>
          <p style={{fontSize: '13px', color: '#64748b', margin: '5px 0'}}>
            {isSelectingStartEnd ? '提示：在地图线上点击两次选择起止点' : '点击上方按钮开启起止点选择模式'}
          </p>
        </div>

        {groups.length > 0 && (
          <div className="groups-list">
            <h4>选择组 ({groups.length})</h4>
            {groups.map((g, idx) => (
              <div key={g.id} className={`group-item ${editingGroupId === g.id ? 'editing' : ''}`}>
                <div className="group-header">
                  <span>组 {idx + 1}: {g.end === null ? '待选终点' : `已选 (${g.start.toFixed(0)}m - ${g.end.toFixed(0)}m)`}</span>
                  <div className="group-actions">
                    {g.end !== null && (
                      <button 
                        className={`edit-button ${editingGroupId === g.id ? 'active' : ''}`}
                        onClick={() => handleEditGroup(g.id)}
                      >
                        {editingGroupId === g.id ? '✅ 编辑中' : '✏️ 编辑'}
                      </button>
                    )}
                    <button onClick={() => deleteGroup(g.id)}>删除</button>
                  </div>
                </div>
                {editingGroupId === g.id && g.end !== null && (
                  <div className="group-config">
                    <div className="config-item">
                      <label>间距 (m):</label>
                      <input
                        type="number"
                        value={g.interval}
                        onChange={(e) => updateGroupConfig(g.id, 'interval', Number(e.target.value))}
                        min="10"
                        step="10"
                      />
                    </div>
                    <div className="config-item">
                      <label>长度 (m):</label>
                      <input
                        type="number"
                        value={g.length}
                        onChange={(e) => updateGroupConfig(g.id, 'length', Number(e.target.value))}
                        min="100"
                        step="100"
                      />
                    </div>
                    <button 
                      className="generate-button" 
                      onClick={() => setEditingPropertiesGroupId(g.id)}
                      style={{ marginBottom: '10px', backgroundColor: '#8b5cf6' }}
                    >
                      ⚙️ 属性配置
                    </button>
                    <button className="apply-button" onClick={handleApplyCustomSegments}>✅ 应用配置</button>
                  </div>
                )}
                {g.crossData.length > 0 && (
                  <div className="group-info">
                    垂线: {g.crossData.length} 条 | 间距: {g.interval}m | 长度: {g.length}m
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="config-section">
          <h4>3️⃣ 断面操作</h4>
          <button 
            className={`toggle-button ${isSelectingCrossLines ? 'active' : ''}`}
            onClick={toggleCrossLineSelection}
            style={{marginBottom: '10px'}}
          >
            {isSelectingCrossLines ? '✅ 断面编辑已开启' : '🎯 开启断面编辑'}
          </button>
          
          {isSelectingCrossLines && (
            <div style={{marginBottom: '10px', display: 'flex', gap: '5px'}}>
              <button
                className={`toggle-button ${crossLineEditMode === 'select' ? 'active' : ''}`}
                onClick={() => {
                  setCrossLineEditMode('select');
                  setSelectedCrossLineIndex(null);
                }}
                style={{flex: 1}}
              >
                ✏️ 选择断面
              </button>
              <button
                className={`toggle-button ${crossLineEditMode === 'add' ? 'active' : ''}`}
                onClick={() => {
                  setCrossLineEditMode('add');
                  setSelectedCrossLineIndex(null);
                }}
                style={{flex: 1}}
              >
                ➕ 新建断面
              </button>
            </div>
          )}
          
          {selectedCrossLineIndex !== null && (
            <div style={{marginBottom: '10px', padding: '10px', backgroundColor: '#f0f9ff', borderRadius: '4px'}}>
              <p style={{margin: '0 0 10px 0', fontWeight: 'bold', color: '#0369a1'}}>已选中断面 #{selectedCrossLineIndex + 1}</p>
              <div style={{display: 'flex', gap: '5px', flexWrap: 'wrap'}}>
                <button 
                  onClick={() => translateSelectedCrossLine(-10)}
                  style={{padding: '5px 10px', fontSize: '12px'}}
                >
                  ⬅️ -10m
                </button>
                <button 
                  onClick={() => translateSelectedCrossLine(-1)}
                  style={{padding: '5px 10px', fontSize: '12px'}}
                >
                  ⬅️ -1m
                </button>
                <button 
                  onClick={() => translateSelectedCrossLine(1)}
                  style={{padding: '5px 10px', fontSize: '12px'}}
                >
                  ➡️ +1m
                </button>
                <button 
                  onClick={() => translateSelectedCrossLine(10)}
                  style={{padding: '5px 10px', fontSize: '12px'}}
                >
                  ➡️ +10m
                </button>
              </div>
              <div style={{display: 'flex', gap: '5px', marginTop: '10px'}}>
                <button 
                  onClick={configureSelectedCrossLineProperties}
                  style={{flex: 1, padding: '8px', backgroundColor: '#8b5cf6', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer'}}
                >
                  ⚙️ 属性配置
                </button>
                <button 
                  onClick={deleteSelectedCrossLine}
                  style={{flex: 1, padding: '8px', backgroundColor: '#ef4444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer'}}
                >
                  🗑️ 删除
                </button>
              </div>
            </div>
          )}
          <p style={{fontSize: '13px', color: '#64748b', margin: '5px 0'}}>
            {isSelectingCrossLines 
              ? (crossLineEditMode === 'select' 
                  ? '💡 点击地图上的断面进行选择' 
                  : '💡 点击岸段上的点新建断面')
              : '点击上方按钮开启断面编辑模式'
            }
          </p>
        </div>
        
        <div className="config-section">
          <h4>4️⃣ 开始分析</h4>
          <button 
            className="analysis-button" 
            onClick={handleStartAnalysis}
            disabled={!perpendicularData || perpendicularData.features.length === 0}
          >
            🚀 开始分析（发送全部垂线）
          </button>
          <p style={{fontSize: '13px', color: '#64748b', margin: '5px 0'}}>
            {perpendicularData ? `当前共 ${perpendicularData.features.length} 条垂线` : '请先绘制断面'}
          </p>
        </div>

        <div className="config-section">
          <h4>⚙️ 工具</h4>
          <button 
            className={`toggle-button ${!showCrossLines ? 'off' : ''}`}
            onClick={() => setShowCrossLines(!showCrossLines)}
          >
            {showCrossLines ? '👁️ 隐藏垂线' : '👁️ 显示垂线'}
          </button>
          <button className="clear-button" onClick={onClear}>🧹 清空选择</button>
        </div>
      </div>

      {/* 全局属性配置弹窗 */}
      {showGlobalPropertiesModal && globalProperties && (
        <PropertiesModal
          config={globalProperties}
          title="全局属性配置"
          onSave={(newConfig) => {
            setGlobalProperties(newConfig);
            alert('全局属性配置已更新');
          }}
          onClose={() => setShowGlobalPropertiesModal(false)}
        />
      )}

      {/* 组属性配置弹窗 */}
      {editingPropertiesGroupId && (() => {
        // 检查是否是单个断面的属性配置
        if (editingPropertiesGroupId.startsWith('cross-line-')) {
          const index = parseInt(editingPropertiesGroupId.replace('cross-line-', ''));
          if (!perpendicularData || !perpendicularData.features[index]) return null;
          
          const currentLine = perpendicularData.features[index];
          const currentConfig = (currentLine.properties as any)?.properties || globalProperties;
          const sectionId = (currentLine.properties as any)?.sectionId;
          
          if (!currentConfig) {
            alert('断面参数未加载，请稍后再试');
            setEditingPropertiesGroupId(null);
            return null;
          }
          
          return (
            <PropertiesModal
              config={currentConfig}
              title={`断面 #${index + 1} 属性配置`}
              sectionId={sectionId}
              onSave={(newConfig) => {
                // 更新前端状态
                const updatedFeatures = [...perpendicularData.features];
                updatedFeatures[index] = {
                  ...currentLine,
                  properties: {
                    ...currentLine.properties,
                    properties: newConfig
                  }
                };
                setPerpendicularData(turf.featureCollection(updatedFeatures as GeoJSON.Feature<GeoJSON.LineString>[]));
                alert(`断面 #${index + 1} 的属性配置已保存`);
              }}
              onClose={() => setEditingPropertiesGroupId(null)}
            />
          );
        }
        
        // 组属性配置
        const group = groups.find(g => g.id === editingPropertiesGroupId);
        if (!group) return null;
        
        const groupConfig = group.properties || globalProperties;
        if (!groupConfig) {
          alert('参数未加载，请先创建断面');
          setEditingPropertiesGroupId(null);
          return null;
        }
        
        return (
          <PropertiesModal
            config={groupConfig}
            title={`组 ${groups.findIndex(g => g.id === editingPropertiesGroupId) + 1} 属性配置`}
            onSave={(newConfig) => {
              setGroups(prev => {
                const updated = [...prev];
                const idx = updated.findIndex(g => g.id === editingPropertiesGroupId);
                if (idx !== -1) {
                  updated[idx] = { ...updated[idx], properties: newConfig };
                }
                return updated;
              });
              alert(`组 ${groups.findIndex(g => g.id === editingPropertiesGroupId) + 1} 的属性配置已保存\n\n注意：需要点击"应用配置"才能将属性更新到垂线上`);
            }}
            onClose={() => setEditingPropertiesGroupId(null)}
          />
        );
      })()}
    </div>
  );
}

export default EditorPage;
