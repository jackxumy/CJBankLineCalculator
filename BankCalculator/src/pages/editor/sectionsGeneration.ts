import * as turf from '@turf/turf';
import { generatePerpendicularLines } from '../../utils/geometry';
import { ensureDefaultBasicParams } from '../../services/basicParamsService';
import type { SectionParams } from '../../types/sections';
import { fetchSectionParams } from './sectionApi';
import { getCurrentTaskId, setCurrentTaskId } from './taskState';

export async function generateSectionsAndCreateTask(params: {
  uploadedData: GeoJSON.FeatureCollection;
  selectedLines: Set<string>;
  globalInterval: number;
  globalLength: number;
  globalProperties: SectionParams | null;
  setPerpendicularData: (v: GeoJSON.FeatureCollection | null) => void;
  setShowCrossLines: (v: boolean) => void;
  setGlobalProperties: (v: SectionParams | null) => void;
}) {
  const {
    uploadedData,
    selectedLines,
    globalInterval,
    globalLength,
    globalProperties,
    setPerpendicularData,
    setShowCrossLines,
    setGlobalProperties,
  } = params;

  if (selectedLines.size === 0) {
    alert('请先选择用于分析的岸段');
    return;
  }

  try {
    const basicParamId = await ensureDefaultBasicParams();
    if (!basicParamId) {
      alert('初始化默认参数失败，请检查后端连接');
      return;
    }

    const taskName = window.prompt('请输入任务名称：', '岸线分析任务');
    if (!taskName) {
      alert('任务名称不能为空');
      return;
    }

    const taskId = `task-${Date.now()}`;
    setCurrentTaskId(taskId);

    const selectedBankIds: string[] = [];
    selectedLines.forEach((lineId) => {
      selectedBankIds.push(lineId);
    });

    const taskPayload = {
      tasks: [
        {
          task_id: taskId,
          task_name: taskName,
          bank_ids: selectedBankIds,
          description: `通过前端创建的任务: ${taskName}`,
        },
      ],
      overwrite: false,
    };

    console.log('创建任务:', taskPayload);
    const taskResponse = await fetch('/v0/bank/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(taskPayload),
    });

    if (!taskResponse.ok) {
      throw new Error(`创建任务失败: ${taskResponse.statusText}`);
    }

    const allPerpendicularLines: GeoJSON.Feature<GeoJSON.LineString>[] = [];
    const sectionsToCreate: any[] = [];

    uploadedData.features.forEach((feature, index) => {
      const lineId = `line-${index}`;
      if (!selectedLines.has(lineId)) return;

      if (feature.geometry.type === 'LineString') {
        const line = feature as GeoJSON.Feature<GeoJSON.LineString>;
        const lineLengthMeters = turf.length(line, { units: 'meters' });

        const { featureCollection } = generatePerpendicularLines(line, 0, lineLengthMeters, globalInterval, globalLength);

        featureCollection.features.forEach((f) => {
          if (!f.properties) f.properties = {};
          (f.properties as any).shoreLineIndex = index;
          (f.properties as any).shoreLineId = lineId;
        });

        allPerpendicularLines.push(...(featureCollection.features as GeoJSON.Feature<GeoJSON.LineString>[]));
      } else if (feature.geometry.type === 'MultiLineString') {
        const multiLine = feature.geometry as GeoJSON.MultiLineString;
        multiLine.coordinates.forEach((coords) => {
          const line = turf.lineString(coords) as GeoJSON.Feature<GeoJSON.LineString>;
          const lineLengthMeters = turf.length(line, { units: 'meters' });

          const { featureCollection } = generatePerpendicularLines(line, 0, lineLengthMeters, globalInterval, globalLength);

          featureCollection.features.forEach((f) => {
            if (!f.properties) f.properties = {};
            (f.properties as any).shoreLineIndex = index;
            (f.properties as any).shoreLineId = lineId;
          });

          allPerpendicularLines.push(...(featureCollection.features as GeoJSON.Feature<GeoJSON.LineString>[]));
        });
      }
    });

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
        basic_param_id: basicParamId,
      });

      line.properties = {
        sectionId,
        crossLineId: index,
        distance: props.distance,
        shoreLineIndex: props.shoreLineIndex,
        shoreLineId: props.shoreLineId,
        leftPoint: props.leftPoint,
        rightPoint: props.rightPoint,
      };
    });

    const sectionsPayload = {
      task_id: taskId,
      sections: sectionsToCreate,
      inherit_from_basic_param: true,
      overwrite: false,
    };

    console.log(`创建 ${sectionsToCreate.length} 个断面...`);
    console.log('发送到后端的数据:', JSON.stringify(sectionsPayload, null, 2));
    const sectionsResponse = await fetch('/v0/bank/sections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sectionsPayload),
    });

    if (!sectionsResponse.ok) {
      const errorText = await sectionsResponse.text();
      console.error('后端错误响应:', errorText);
      throw new Error(`创建断面失败: ${sectionsResponse.statusText} - ${errorText}`);
    }

    const sectionsResult = await sectionsResponse.json();
    console.log('断面创建成功:', sectionsResult);

    if (sectionsResult.success && sectionsResult.sections && sectionsResult.sections.length > 0) {
      const firstSection = sectionsResult.sections[0];
      const fetched = await fetchSectionParams(firstSection.section_id);
      if (fetched) {
        console.log('获取到断面参数:', fetched);
        setGlobalProperties(fetched);
      }
    } else if (!globalProperties) {
      // no-op: 保持现有逻辑，不强行补默认
    }

    setPerpendicularData(turf.featureCollection(allPerpendicularLines));
    setShowCrossLines(true);
    alert(`任务创建成功！\n已为 ${selectedLines.size} 个岸段生成 ${allPerpendicularLines.length} 条断面！`);
  } catch (err: any) {
    console.error('生成断面失败:', err);
    alert(`生成断面失败: ${err.message}`);
  }
}

export async function runCurrentTask(params: { perpendicularData: GeoJSON.FeatureCollection }) {
  const { perpendicularData } = params;

  if (!perpendicularData || perpendicularData.features.length === 0) {
    alert('请先绘制断面');
    return;
  }

  const taskId = getCurrentTaskId();
  if (!taskId) {
    alert('未找到任务ID，请先绘制断面');
    return;
  }

  try {
    console.log(`开始分析任务: ${taskId}`);

    const response = await fetch(`/v0/bank/tasks/${taskId}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
}
