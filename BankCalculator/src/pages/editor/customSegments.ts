import * as turf from '@turf/turf';
import type { Dispatch, SetStateAction } from 'react';
import { generatePerpendicularLines } from '../../utils/geometry';
import type { SectionParams } from '../../types/sections';
import type { SelectionGroup } from '../../types/selection';

export function applyCustomSegmentsAction(params: {
  editingGroupId: string | null;
  groups: SelectionGroup[];
  perpendicularData: GeoJSON.FeatureCollection | null;
  globalLength: number;
  globalProperties: SectionParams | null;
  setGroups: Dispatch<SetStateAction<SelectionGroup[]>>;
  setPerpendicularData: (v: GeoJSON.FeatureCollection | null) => void;
}) {
  const {
    editingGroupId,
    groups,
    perpendicularData,
    globalLength,
    globalProperties,
    setGroups,
    setPerpendicularData,
  } = params;

  if (!editingGroupId) {
    alert('请先点击编辑按钮选择要修改的组');
    return;
  }

  const editingGroup = groups.find((g) => g.id === editingGroupId);
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

  const intervalChanged = editingGroup.interval !== editingGroup.lastAppliedInterval;

  let updatedLines = [...perpendicularData.features] as GeoJSON.Feature<GeoJSON.LineString>[];

  if (!intervalChanged) {
    const newCrossData: { distance: number; left: number[]; right: number[] }[] = [];

    updatedLines = updatedLines.map((line) => {
      const lineProp: any = line.properties || {};
      const leftPoint = lineProp.leftPoint as number[] | undefined;
      const rightPoint = lineProp.rightPoint as number[] | undefined;
      if (!leftPoint || !rightPoint) return line;

      try {
        const mid = [(leftPoint[0] + rightPoint[0]) / 2, (leftPoint[1] + rightPoint[1]) / 2];
        const midPoint = turf.point(mid);
        const snapped = turf.nearestPointOnLine(editingGroup.line, midPoint, { units: 'meters' });
        const actualDist = snapped.properties.location ?? 0;
        const distToLine = turf.distance(midPoint, snapped, { units: 'meters' });

        if (distToLine > Math.max(globalLength, editingGroup.length) / 2 + 100) {
          return line;
        }
        if (actualDist < start || actualDist > end) {
          return line;
        }

        const centerPoint = snapped as GeoJSON.Feature<GeoJSON.Point>;
        const bearingToLeft = turf.bearing(centerPoint, turf.point(leftPoint));
        const halfLen = editingGroup.length / 2;

        const leftEnd = turf.destination(centerPoint, halfLen, bearingToLeft, { units: 'meters' });
        const rightEnd = turf.destination(centerPoint, halfLen, bearingToLeft + 180, { units: 'meters' });

        const newLeft = leftEnd.geometry.coordinates as number[];
        const newRight = rightEnd.geometry.coordinates as number[];

        line.geometry = {
          type: 'LineString',
          coordinates: [newLeft, newRight],
        };

        line.properties = {
          crossLineId: lineProp.crossLineId,
          distance: lineProp.distance,
          shoreLineIndex: lineProp.shoreLineIndex,
          shoreLineId: lineProp.shoreLineId,
          leftPoint: newLeft,
          rightPoint: newRight,
          analysisConfig: editingGroup.properties || { ...globalProperties },
        };

        newCrossData.push({ distance: actualDist, left: newLeft, right: newRight });

        return line;
      } catch {
        return line;
      }
    });

    newCrossData.sort((a, b) => a.distance - b.distance);

    setGroups((prev) => {
      const updated = [...prev];
      const idx = updated.findIndex((g) => g.id === editingGroup.id);
      if (idx !== -1) {
        updated[idx] = {
          ...editingGroup,
          crossData: newCrossData,
          lastAppliedInterval: editingGroup.interval,
        };
      }
      return updated;
    });

    setPerpendicularData(turf.featureCollection(updatedLines));
    alert(`已更新组 ${groups.findIndex((g) => g.id === editingGroupId) + 1} 的垂线长度（未修改间距）`);
    return;
  }

  updatedLines = updatedLines.filter((line) => {
    const lineProp = line.properties as any;
    if (!lineProp) return true;

    const leftPoint = lineProp.leftPoint as number[] | undefined;
    const rightPoint = lineProp.rightPoint as number[] | undefined;
    if (!leftPoint || !rightPoint) return true;

    try {
      const midPoint = turf.point([(leftPoint[0] + rightPoint[0]) / 2, (leftPoint[1] + rightPoint[1]) / 2]);
      const distOnLine = turf.nearestPointOnLine(editingGroup.line, midPoint, { units: 'meters' });
      const actualDist = distOnLine.properties.location ?? 0;

      const distToLine = turf.distance(midPoint, distOnLine, { units: 'meters' });

      if (distToLine > Math.max(globalLength, editingGroup.length) / 2 + 100) {
        return true;
      }

      if (actualDist >= start && actualDist <= end) {
        return false;
      }

      return true;
    } catch {
      return true;
    }
  });

  const { featureCollection, endpointData } = generatePerpendicularLines(
    editingGroup.line,
    start,
    end,
    editingGroup.interval,
    editingGroup.length,
  );

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
      leftPoint,
      rightPoint,
      analysisConfig: editingGroup.properties || { ...globalProperties },
    };
  });

  setGroups((prev) => {
    const updated = [...prev];
    const idx = updated.findIndex((g) => g.id === editingGroup.id);
    if (idx !== -1) {
      updated[idx] = {
        ...editingGroup,
        crossData: endpointData,
        lastAppliedInterval: editingGroup.interval,
      };
    }
    return updated;
  });

  updatedLines.push(...(featureCollection.features as GeoJSON.Feature<GeoJSON.LineString>[]));

  setPerpendicularData(turf.featureCollection(updatedLines));
  alert(`已应用组 ${groups.findIndex((g) => g.id === editingGroupId) + 1} 的自定义配置（修改了间距，已重绘）`);
}
