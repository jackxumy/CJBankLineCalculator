import * as turf from '@turf/turf';
import type { Dispatch, SetStateAction } from 'react';
import type { SectionParams } from '../../types/sections';
import { ensureDefaultBasicParams } from '../../services/basicParamsService';
import { fetchSectionParams } from './sectionApi';
import { getCurrentTaskId } from './taskState';

export async function reverseSelectedCrossLineAction(params: {
  selectedCrossLineIndex: number | null;
  perpendicularData: GeoJSON.FeatureCollection | null;
  setPerpendicularData: (v: GeoJSON.FeatureCollection | null) => void;
}) {
  const { selectedCrossLineIndex, perpendicularData, setPerpendicularData } = params;

  if (selectedCrossLineIndex === null || !perpendicularData) {
    alert('请先选择要反转的断面');
    return;
  }

  const selectedLine = perpendicularData.features[selectedCrossLineIndex];
  if (!selectedLine || selectedLine.geometry.type !== 'LineString') return;

  const coords = selectedLine.geometry.coordinates as number[][];
  const newCoords = [coords[1], coords[0]];

  const newGeometry: GeoJSON.LineString = {
    type: 'LineString',
    coordinates: newCoords,
  };

  const sectionId = (selectedLine.properties as any)?.sectionId;

  if (!sectionId) {
    const updatedFeatures = [...perpendicularData.features];
    updatedFeatures[selectedCrossLineIndex] = {
      ...selectedLine,
      geometry: newGeometry,
      properties: {
        ...selectedLine.properties,
        leftPoint: (selectedLine.properties as any)?.rightPoint,
        rightPoint: (selectedLine.properties as any)?.leftPoint,
      },
    };
    setPerpendicularData(turf.featureCollection(updatedFeatures as GeoJSON.Feature<GeoJSON.LineString>[]));
    console.log('已在前端反转断面（未同步到后端）');
    return;
  }

  try {
    const response = await fetch(`/v0/bank/sections/${sectionId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reverse: true }),
    });

    if (!response.ok) {
      throw new Error(`反转断面失败: ${response.statusText}`);
    }

    const updatedFeatures = [...perpendicularData.features];
    updatedFeatures[selectedCrossLineIndex] = {
      ...selectedLine,
      geometry: newGeometry,
      properties: {
        ...selectedLine.properties,
        leftPoint: (selectedLine.properties as any)?.rightPoint,
        rightPoint: (selectedLine.properties as any)?.leftPoint,
      },
    };
    setPerpendicularData(turf.featureCollection(updatedFeatures as GeoJSON.Feature<GeoJSON.LineString>[]));
    console.log(`已在后端反转断面: ${sectionId}`);
  } catch (err: any) {
    console.error('反转断面失败:', err);
    alert(`反转断面失败: ${err.message}`);
  }
}

export async function createCrossLineAtPointAction(params: {
  line: GeoJSON.Feature<GeoJSON.LineString>;
  distanceOnLine: number;
  globalLength: number;
  perpendicularData: GeoJSON.FeatureCollection | null;
  globalProperties: SectionParams | null;
  setGlobalProperties: (v: SectionParams | null) => void;
  setPerpendicularData: Dispatch<SetStateAction<GeoJSON.FeatureCollection | null>>;
}) {
  const {
    line,
    distanceOnLine,
    globalLength,
    perpendicularData,
    globalProperties,
    setGlobalProperties,
    setPerpendicularData,
  } = params;

  const taskId = getCurrentTaskId();
  if (!taskId) {
    alert('未找到任务ID，请先创建任务');
    return;
  }

  const basicParamId = await ensureDefaultBasicParams();
  if (!basicParamId) {
    alert('获取默认参数失败');
    return;
  }

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

  const parentIndex = (line.properties as any)?.index;
  const parentId = parentIndex !== undefined ? `line-${parentIndex}` : undefined;

  const newGeometry: GeoJSON.LineString = {
    type: 'LineString',
    coordinates: [leftCoords, rightCoords],
  };

  try {
    const sectionId = `sec-${taskId}-new-${Date.now()}`;
    const newSectionIndex = perpendicularData ? perpendicularData.features.length : 0;

    const sectionsPayload = {
      task_id: taskId,
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
          basic_param_id: basicParamId,
        },
      ],
      inherit_from_basic_param: true,
      overwrite: false,
    };

    const response = await fetch('/v0/bank/sections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sectionsPayload),
    });

    if (!response.ok) {
      throw new Error(`创建断面失败: ${response.statusText}`);
    }

    const result = await response.json();
    console.log('断面创建成功:', result);

    if (result.success && result.sections && result.sections.length > 0) {
      const createdSection = result.sections[0];
      const fetched = await fetchSectionParams(createdSection.section_id);
      if (fetched) {
        console.log('获取到断面参数:', fetched);
        if (!globalProperties) {
          setGlobalProperties(fetched);
        }
      }
    }

    setPerpendicularData((prev) => {
      const existing = prev ? (prev.features as GeoJSON.Feature<GeoJSON.LineString>[]) : [];
      const newCrossLineId = existing.length;

      const newCrossLine: GeoJSON.Feature<GeoJSON.LineString> = {
        type: 'Feature',
        properties: {
          sectionId,
          crossLineId: newCrossLineId,
          distance: distanceOnLine,
          shoreLineIndex: parentIndex,
          shoreLineId: parentId,
          leftPoint: leftCoords,
          rightPoint: rightCoords,
        },
        geometry: newGeometry,
      };

      const newFeatures = [...existing, newCrossLine];
      console.log(
        `新建断面 #${newCrossLineId + 1}，位置: ${distanceOnLine.toFixed(2)}m，当前总数: ${newFeatures.length}`,
      );
      return turf.featureCollection(newFeatures);
    });
  } catch (err: any) {
    console.error('新建断面失败:', err);
    alert(`新建断面失败: ${err.message}`);
  }
}

export async function deleteSelectedCrossLineAction(params: {
  selectedCrossLineIndex: number | null;
  perpendicularData: GeoJSON.FeatureCollection | null;
  setPerpendicularData: (v: GeoJSON.FeatureCollection | null) => void;
  setSelectedCrossLineIndex: (v: number | null) => void;
}) {
  const { selectedCrossLineIndex, perpendicularData, setPerpendicularData, setSelectedCrossLineIndex } = params;

  if (selectedCrossLineIndex === null || !perpendicularData) {
    alert('请先选择要删除的断面');
    return;
  }

  const features = perpendicularData.features as GeoJSON.Feature<GeoJSON.LineString>[];
  const selectedFeature = features[selectedCrossLineIndex];
  const sectionId = (selectedFeature.properties as any)?.sectionId;

  if (!sectionId) {
    const updatedFeatures = perpendicularData.features.filter((_, index) => index !== selectedCrossLineIndex);
    updatedFeatures.forEach((feature, index) => {
      if (feature.properties) {
        (feature.properties as any).crossLineId = index;
      }
    });
    setPerpendicularData(turf.featureCollection(updatedFeatures));
    setSelectedCrossLineIndex(null);
    console.log('已删除未同步断面');
    alert('已删除选中的断面');
    return;
  }

  try {
    const response = await fetch(`/v0/bank/sections/${sectionId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      throw new Error(`删除断面失败: ${response.statusText}`);
    }

    const updatedFeatures = perpendicularData.features.filter((_, index) => index !== selectedCrossLineIndex);
    updatedFeatures.forEach((feature, index) => {
      if (feature.properties) {
        (feature.properties as any).crossLineId = index;
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
}

export async function translateSelectedCrossLineAction(params: {
  offsetMeters: number;
  selectedCrossLineIndex: number | null;
  perpendicularData: GeoJSON.FeatureCollection | null;
  uploadedData: GeoJSON.FeatureCollection | null;
  setPerpendicularData: (v: GeoJSON.FeatureCollection | null) => void;
}) {
  const { offsetMeters, selectedCrossLineIndex, perpendicularData, uploadedData, setPerpendicularData } = params;

  if (selectedCrossLineIndex === null || !perpendicularData) {
    alert('请先选择要平移的断面');
    return;
  }

  const selectedLine = perpendicularData.features[selectedCrossLineIndex];
  if (!selectedLine || selectedLine.geometry.type !== 'LineString') return;

  const coords = selectedLine.geometry.coordinates as number[][];
  const leftPoint = coords[0];
  const rightPoint = coords[1];

  const currentDistance = (selectedLine.properties as any)?.distance;
  const shoreLineIndex = (selectedLine.properties as any)?.shoreLineIndex;

  if (currentDistance === undefined || shoreLineIndex === undefined || !uploadedData) {
    alert('无法获取断面对应的岸线信息，平移操作暂不可用');
    return;
  }

  const shoreLine = uploadedData.features[shoreLineIndex] as GeoJSON.Feature<GeoJSON.LineString>;
  if (!shoreLine || shoreLine.geometry.type !== 'LineString') return;

  const shoreLineLength = turf.length(shoreLine, { units: 'meters' });
  const newDistance = Math.max(0, Math.min(shoreLineLength, currentDistance + offsetMeters));

  const pointOnLine = turf.along(shoreLine, newDistance, { units: 'meters' });
  const nextDist = Math.min(newDistance + 0.1, shoreLineLength);
  const nextPoint = turf.along(shoreLine, nextDist, { units: 'meters' });

  let bearing = 0;
  if (newDistance >= shoreLineLength - 0.1) {
    const prevPoint = turf.along(shoreLine, Math.max(0, newDistance - 0.1), { units: 'meters' });
    bearing = turf.bearing(prevPoint, pointOnLine);
  } else {
    bearing = turf.bearing(pointOnLine, nextPoint);
  }

  const currentTotalLength = turf.distance(turf.point(leftPoint), turf.point(rightPoint), { units: 'meters' });
  const halfLength = currentTotalLength / 2;

  const newLeftPoint = turf.destination(pointOnLine, halfLength, bearing - 90, { units: 'meters' });
  const newRightPoint = turf.destination(pointOnLine, halfLength, bearing + 90, { units: 'meters' });

  const newGeometry: GeoJSON.LineString = {
    type: 'LineString',
    coordinates: [newLeftPoint.geometry.coordinates, newRightPoint.geometry.coordinates],
  };

  const sectionId = (selectedLine.properties as any)?.sectionId;

  if (!sectionId) {
    const updatedFeatures = [...perpendicularData.features];
    updatedFeatures[selectedCrossLineIndex] = {
      ...selectedLine,
      geometry: newGeometry,
      properties: {
        ...selectedLine.properties,
        distance: newDistance,
        crossLineId: (selectedLine.properties as any)?.crossLineId ?? selectedCrossLineIndex,
        leftPoint: newLeftPoint.geometry.coordinates,
        rightPoint: newRightPoint.geometry.coordinates,
      },
    };
    setPerpendicularData(turf.featureCollection(updatedFeatures as GeoJSON.Feature<GeoJSON.LineString>[]));
    console.log('已平移未同步断面');
    return;
  }

  try {
    const response = await fetch(`/v0/bank/sections/${sectionId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        distance: newDistance,
        geometry: newGeometry,
        section_geometry: newGeometry,
      }),
    });

    if (!response.ok) {
      throw new Error(`更新断面几何失败: ${response.statusText}`);
    }

    const updatedFeatures = [...perpendicularData.features];
    updatedFeatures[selectedCrossLineIndex] = {
      ...selectedLine,
      geometry: newGeometry,
      properties: {
        ...selectedLine.properties,
        distance: newDistance,
        crossLineId: (selectedLine.properties as any)?.crossLineId ?? selectedCrossLineIndex,
        leftPoint: newLeftPoint.geometry.coordinates,
        rightPoint: newRightPoint.geometry.coordinates,
      },
    };
    setPerpendicularData(turf.featureCollection(updatedFeatures as GeoJSON.Feature<GeoJSON.LineString>[]));
    console.log(`已更新后端断面几何: ${sectionId}`);
  } catch (err: any) {
    console.error('平移断面失败:', err);
    alert(`平移断面失败: ${err.message}`);
  }
}

export async function configureSelectedCrossLinePropertiesAction(params: {
  selectedCrossLineIndex: number | null;
  perpendicularData: GeoJSON.FeatureCollection | null;
  setEditingPropertiesGroupId: (v: string | null) => void;
}) {
  const { selectedCrossLineIndex, perpendicularData, setEditingPropertiesGroupId } = params;

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
    const response = await fetch(`/v0/bank/sections/${sectionId}`);
    if (!response.ok) {
      throw new Error(`获取断面参数失败: ${response.statusText}`);
    }

    const data = await response.json();
    if (data.success && data.section) {
      const backendParams = data.section;
      (selectedLine.properties as any).backendParams = backendParams;
      setEditingPropertiesGroupId(`cross-line-${selectedCrossLineIndex}`);
    }
  } catch (err: any) {
    console.error('获取断面参数失败:', err);
    alert(`获取断面参数失败: ${err.message}`);
  }
}
