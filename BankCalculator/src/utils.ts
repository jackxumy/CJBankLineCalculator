import * as turf from '@turf/turf';
import { ANALYSIS_CONFIG_DEFAULT, type AnalysisConfig } from './constants';

/**
 * 在线上以固定间距生成断面（移到 utils）
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

/**
 * 发送断面数据到后端（移到 utils）
 */
export async function sendCrossLinesToBackend(
  crossData: { distance: number; left: number[]; right: number[]; analysisConfig?: typeof ANALYSIS_CONFIG_DEFAULT }[],
  groupId: string
) {
  console.log(`开始向后端发送组 ${groupId} 的 ${crossData.length} 条断面数据...`);

  try {
    const promises = crossData.map(async (item, index) => {
      const payload = {
        ...(item.analysisConfig || ANALYSIS_CONFIG_DEFAULT),
        "section-geometry": {
          "type": "Feature",
          "properties": { "distance": item.distance, "index": index },
          "geometry": { 
            "type": "LineString", 
            "coordinates": [item.left, item.right] 
          }
        }
      };

      console.log(`正在发送断面 ${index + 1}/${crossData.length} (距离: ${item.distance.toFixed(2)}m):`, payload);

      const response = await fetch('http://192.168.1.116:8088/v0/mi/risk-level', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`请求失败: ${response.statusText}`);
      }

      const result = await response.json();
      console.log(`断面 ${index + 1}/${crossData.length} (距离: ${item.distance.toFixed(2)}m) 已发送`);
      return result;
    });

    const results = await Promise.all(promises);
    console.log(`组 ${groupId} 的所有断面数据已成功发送到后端`);
    return results;
  } catch (error) {
    console.error(`发送组 ${groupId} 的断面数据时出错:`, error);
    throw error;
  }
}

export default { generatePerpendicularLines, sendCrossLinesToBackend };
