import { useEffect, useState } from 'react';
import * as turf from '@turf/turf';
import '../App.css';
import type { SectionParams } from '../types/sections';
import SectionPropertiesModal from '../components/SectionPropertiesModal';
import EditorSidebar from '../components/EditorSidebar';
import EditorMap from '../components/EditorMap';
import { generatePerpendicularLines } from '../utils/geometry';
import { ensureDefaultBasicParams, setCurrentBasicParamId } from '../services/basicParamsService';
import type { SelectionGroup } from '../types/selection';

// 新增：当前任务ID状态
let currentTaskId: string | null = null;

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
  // 上传的 GeoJSON 数据 (主线)
  const [uploadedData, setUploadedData] = useState<GeoJSON.FeatureCollection | null>(null);
  // 生成的垂线数据
  const [perpendicularData, setPerpendicularData] = useState<GeoJSON.FeatureCollection | null>(null);

  // 参数模板列表与选择（从后端获取并允许用户选择）
  const [basicParamsList, setBasicParamsList] = useState<any[]>([]);
  const [selectedBasicParamIdState, setSelectedBasicParamIdState] = useState<string | number | null>(null);

  // 所有选择组
  const [groups, setGroups] = useState<SelectionGroup[]>([]);

  // 全局垂线配置（用于首次绘制整个 GeoJSON）
  const [globalInterval, setGlobalInterval] = useState<number>(100);
  const [globalLength, setGlobalLength] = useState<number>(2000);
  
  // 当前正在编辑的组ID
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  
  const [showCrossLines, setShowCrossLines] = useState<boolean>(true);
  
  // 全局属性配置
  const [globalProperties, setGlobalProperties] = useState<SectionParams | null>(null);
  // 属性配置弹窗状态
  const [showGlobalPropertiesModal, setShowGlobalPropertiesModal] = useState<boolean>(false);
  const [editingPropertiesGroupId, setEditingPropertiesGroupId] = useState<string | null>(null);
  
  // 新增状态：控制岸段选择模式
  const [isSelectingShoreLines, setIsSelectingShoreLines] = useState<boolean>(false);
  
  // 新增状态：控制起止点选择模式
  const [isSelectingStartEnd, setIsSelectingStartEnd] = useState<boolean>(false);
  
  // 新增状态：选中的用于生成垂线的线段（存储线的唯一标识）
  const [selectedLines, setSelectedLines] = useState<Set<string>>(new Set());
  
  // 新增状态：控制断面选择模式
  const [isSelectingCrossLines, setIsSelectingCrossLines] = useState<boolean>(false);
  
  // 新增状态：断面编辑模式 ('select' 选择现有断面, 'add' 新建断面)
  const [crossLineEditMode, setCrossLineEditMode] = useState<'select' | 'add'>('select');
  
  // 新增状态：选中的断面索引
  const [selectedCrossLineIndex, setSelectedCrossLineIndex] = useState<number | null>(null);

  // 挂载时拉取可用的基础参数模板列表
  useEffect(() => {
    const fetchBasicParams = async () => {
      try {
        const res = await fetch('/v0/bank/basic-params');
        if (!res.ok) {
          console.warn('获取基础参数模板列表失败:', res.statusText);
          return;
        }
        const data = await res.json();
        if (data && data.params) {
          setBasicParamsList(data.params);
          console.log('拉取到的基础参数模板列表:', data.params);
          // 如果后端有模板，默认选第一个（可由用户切换）
          if (data.params.length > 0) {
            const first = data.params[0];
            // 使用 param_id 字符串作为标识（API 路由使用 param_id，不是数字 id）
            const paramId = first.param_id ?? first.id ?? null;
            if (paramId !== null) {
              setSelectedBasicParamIdState(String(paramId));
              // 同步到服务中的基础参数ID（保留数字 id 供后续使用）
              setCurrentBasicParamId(first.id ?? null);
              // 同步全局属性以供 UI 使用
              // 若需要完整详情，可后续用户选择时 fetch 单个模板
            }
          }
        }
      } catch (err) {
        console.warn('加载基础参数模板列表出错:', err);
      }
    };

    fetchBasicParams();
  }, []);

  // 当用户选择模板时，拉取模板详情并设置为全局属性
  const handleSelectBasicParam = async (paramIdStr: string | null) => {
    if (!paramIdStr) {
      setSelectedBasicParamIdState(null);
      setCurrentBasicParamId(null);
      setGlobalProperties(null);
      return;
    }

    // 使用 param_id（字符串）请求后端 GET /v0/bank/basic-params/{param_id}
    try {
      const res = await fetch(`/v0/bank/basic-params/${encodeURIComponent(paramIdStr)}`);
      if (!res.ok) {
        console.warn('获取模板详情失败:', res.status);
        setSelectedBasicParamIdState(null);
        return;
      }
      const data = await res.json();
      if (data && data.param) {
        console.log('获取到模板详情:', data.param);
        // 转换为 SectionParams 结构的部分字段
        const params: SectionParams = {
          param_name: data.param.param_name,
          segment: data.param.segment,
          current_timepoint: data.param.current_timepoint,
          set_name: data.param.set_name,
          water_qs: data.param.water_qs,
          tidal_level: data.param.tidal_level,
          bench_id: data.param.bench_id,
          ref_id: data.param.ref_id,
          hs: data.param.hs,
          hc: data.param.hc,
          protection_level: data.param.protection_level,
          control_level: data.param.control_level,
          comparison_timepoint: data.param.comparison_timepoint,
          risk_thresholds: data.param.risk_thresholds,
          weights: data.param.weights,
          other_params: data.param.other_params
        };

        setGlobalProperties(params);
        setSelectedBasicParamIdState(paramIdStr);
        // 同步到服务中的基础参数ID
        setCurrentBasicParamId(data.param.id ?? null);
      }
    } catch (err) {
      console.warn('加载模板详情失败:', err);
    }
  };

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

    const currentLength = globalLength;
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
          if (!globalProperties) {
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

      } catch (err) {
        alert('解析 GeoJSON 失败，请检查文件格式');
      }
    };
    reader.readAsText(file);
  };

  // 地图相关逻辑已移动到 EditorMap 组件中

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

  return (
    <div className="map-wrapper">
      <EditorMap
        perpendicularData={perpendicularData}
        uploadedData={uploadedData}
        groups={groups}
        showCrossLines={showCrossLines}
        isSelectingShoreLines={isSelectingShoreLines}
        isSelectingStartEnd={isSelectingStartEnd}
        isSelectingCrossLines={isSelectingCrossLines}
        crossLineEditMode={crossLineEditMode}
        selectedLines={selectedLines}
        setSelectedLines={setSelectedLines}
        setGroups={setGroups}
        selectedCrossLineIndex={selectedCrossLineIndex}
        setSelectedCrossLineIndex={setSelectedCrossLineIndex}
        globalInterval={globalInterval}
        globalLength={globalLength}
        createCrossLineAtPoint={createCrossLineAtPoint}
      />
      <EditorSidebar
        uploadedData={uploadedData}
        basicParamsList={basicParamsList}
        selectedBasicParamIdState={selectedBasicParamIdState}
        totalSelectedSegments={totalSelectedSegments}
        totalCrossLinesCount={totalCrossLinesCount}
        globalInterval={globalInterval}
        setGlobalInterval={setGlobalInterval}
        globalLength={globalLength}
        setGlobalLength={setGlobalLength}
        isSelectingShoreLines={isSelectingShoreLines}
        toggleShoreLineSelection={toggleShoreLineSelection}
        selectAllShoreLines={selectAllShoreLines}
        selectedLinesSize={selectedLines.size}
        handleGenerateSections={handleGenerateSections}
        perpendicularData={perpendicularData}
        setShowGlobalPropertiesModal={setShowGlobalPropertiesModal}
        isSelectingStartEnd={isSelectingStartEnd}
        toggleStartEndSelection={toggleStartEndSelection}
        groups={groups}
        editingGroupId={editingGroupId}
        handleEditGroup={handleEditGroup}
        deleteGroup={deleteGroup}
        updateGroupConfig={updateGroupConfig}
        setEditingPropertiesGroupId={setEditingPropertiesGroupId}
        handleApplyCustomSegments={handleApplyCustomSegments}
        isSelectingCrossLines={isSelectingCrossLines}
        toggleCrossLineSelection={toggleCrossLineSelection}
        crossLineEditMode={crossLineEditMode}
        setCrossLineEditMode={setCrossLineEditMode}
        selectedCrossLineIndex={selectedCrossLineIndex}
        translateSelectedCrossLine={translateSelectedCrossLine}
        configureSelectedCrossLineProperties={configureSelectedCrossLineProperties}
        deleteSelectedCrossLine={deleteSelectedCrossLine}
        showCrossLines={showCrossLines}
        setShowCrossLines={setShowCrossLines}
        handleStartAnalysis={handleStartAnalysis}
        onClear={onClear}
        handleFileUpload={handleFileUpload}
        handleSelectBasicParam={handleSelectBasicParam}
      />

      {/* 全局属性配置弹窗 */}
      {showGlobalPropertiesModal && globalProperties && (
        <SectionPropertiesModal
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
            <SectionPropertiesModal
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
          <SectionPropertiesModal
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
