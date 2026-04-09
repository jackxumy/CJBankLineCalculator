import * as turf from '@turf/turf';
import { generatePerpendicularLines } from '../../utils/geometry';
import { ensureDefaultBasicParams } from '../../services/basicParamsService';
import type { SectionParams } from '../../types/sections';
import { fetchSectionParams } from './sectionApi';
import { getCurrentTaskId, setCurrentTaskId } from './taskState';

function getShoreLineIdFromFeature(feature: any, index: number) {
  const p = feature?.properties || {};
  return String(p.bank_id || p.bankId || `line-${index}`);
}

function toLineStrings(geometry: any): Array<{ type: 'LineString'; coordinates: any[] }> {
  if (!geometry) return [];
  if (geometry.type === 'LineString' && Array.isArray(geometry.coordinates)) {
    return [{ type: 'LineString', coordinates: geometry.coordinates }];
  }
  if (geometry.type === 'MultiLineString' && Array.isArray(geometry.coordinates)) {
    return (geometry.coordinates as any[])
      .filter((coords) => Array.isArray(coords) && coords.length >= 2)
      .map((coords) => ({ type: 'LineString' as const, coordinates: coords }));
  }
  return [];
}

function isFromBackendFeature(feature: any) {
  const props = feature?.properties || {};
  return props.from_backend === true || props.fromBackend === true;
}

function extendCrossLineToFirstShorelineIntersection(params: {
  crossLine: GeoJSON.Feature<GeoJSON.LineString>;
  shoreLineId?: string;
  uploadedData: GeoJSON.FeatureCollection;
  // 最大延伸距离：超过仍无交点则丢弃该断面
  maxRayLengthMeters: number;
}): GeoJSON.Feature<GeoJSON.LineString> | null {
  const { crossLine, shoreLineId, uploadedData } = params;
  const maxRayLengthMeters = Math.max(1, Number(params.maxRayLengthMeters));

  const coords = crossLine?.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return crossLine;

  const start0 = coords[0];
  const end0 = coords[coords.length - 1];
  if (!Array.isArray(start0) || !Array.isArray(end0)) return crossLine;

  // 约束 1：只保留“岸线上的点”与“延申后的首次相交点”。
  // 岸线点优先用 generatePerpendicularLines 注入的 anchorPoint，否则退化为断面中点。
  const anchorRaw = (crossLine.properties as any)?.anchorPoint;
  let anchorCoord: number[] | null = Array.isArray(anchorRaw) ? (anchorRaw as any) : null;
  if (!anchorCoord) {
    const mid = turf.midpoint(turf.point(start0 as any), turf.point(end0 as any));
    anchorCoord = mid.geometry.coordinates as any;
  }

  const bearing = turf.bearing(turf.point(start0 as any), turf.point(end0 as any));
  const farEnd = turf.destination(turf.point(anchorCoord as any), maxRayLengthMeters, bearing, { units: 'meters' });
  const ray = turf.lineString([anchorCoord as any, farEnd.geometry.coordinates as any]);

  let bestLocation: number | null = null;
  let bestCoord: number[] | null = null;

  const features = (uploadedData?.features || []) as any[];
  for (let i = 0; i < features.length; i++) {
    const f = features[i];
    const id = getShoreLineIdFromFeature(f, i);
    if (shoreLineId && id === shoreLineId) continue;

    const parts = toLineStrings(f?.geometry);
    for (const part of parts) {
      const shore = turf.lineString(part.coordinates as any);
      const hits = turf.lineIntersect(ray, shore);
      const hitPts = (hits?.features || []) as any[];
      for (const hp of hitPts) {
        const snapped = turf.nearestPointOnLine(ray, hp, { units: 'meters' }) as any;
        const loc = Number(snapped?.properties?.location);
        if (!Number.isFinite(loc)) continue;
        // 避免把起点自身（0 距离）当作相交点
        if (loc < 1) continue;

        if (bestLocation === null || loc < bestLocation) {
          bestLocation = loc;
          bestCoord = hp?.geometry?.coordinates as any;
        }
      }
    }
  }

  // 约束 2：超过 maxRayLengthMeters 仍无交点则丢弃该断面
  if (!bestCoord || bestLocation === null) return null;

  // 只保留两点：岸线锚点 -> 首次相交点
  crossLine.geometry.coordinates = [anchorCoord as any, bestCoord as any];
  if (!crossLine.properties) crossLine.properties = {};
  (crossLine.properties as any).leftPoint = anchorCoord;
  (crossLine.properties as any).rightPoint = bestCoord;
  (crossLine.properties as any).extended_to_shoreline = true;
  (crossLine.properties as any).extended_length_m = bestLocation;

  return crossLine;
}

async function generateSectionsAndCreateTaskCore(params: {
  uploadedData: GeoJSON.FeatureCollection;
  selectedLines: Set<string>;
  globalInterval: number;
  globalLength: number;
  globalProperties: SectionParams | null;
  setPerpendicularData: (v: GeoJSON.FeatureCollection | null) => void;
  setShowCrossLines: (v: boolean) => void;
  setGlobalProperties: (v: SectionParams | null) => void;
  // 若为 true，则在生成断面前不将本地岸段同步上传到后端
  skipUploadBanks?: boolean;
  // 若为 true，则对每条断面沿起点->终点方向延长，直到与遇到的第一个岸线相交
  extendToFirstShorelineIntersection?: boolean;
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

  const ensureBanksUploaded = async (banksToSend: any[]) => {
    if (banksToSend.length === 0) return;

    const results: Array<{ bank_id: string; ok: boolean; status?: number; message?: string }> = [];
    for (const bank of banksToSend) {
      const payload = { banks: [bank], overwrite: false };
      const res = await fetch('/v0/bank/banks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        results.push({ bank_id: String(bank.bank_id), ok: true, status: res.status });
        continue;
      }

      // 若后端提示已存在（例如重复提交），视为成功并继续。
      if (res.status === 409) {
        results.push({ bank_id: String(bank.bank_id), ok: true, status: res.status });
        continue;
      }

      const t = await res.text();

      if (res.status === 400 && typeof t === 'string' && /exist|already|duplicate|conflict/i.test(t)) {
        results.push({ bank_id: String(bank.bank_id), ok: true, status: res.status });
        continue;
      }

      results.push({
        bank_id: String(bank.bank_id),
        ok: false,
        status: res.status,
        message: `${res.status} ${res.statusText} ${t}`,
      });
    }

    const fail = results.filter((r) => !r.ok);
    if (fail.length > 0) {
      const first = fail[0];
      console.error('生成前上传岸段失败明细:', fail);
      throw new Error(`生成前上传岸段失败：首个失败 bank_id=${first.bank_id}：${first.message}`);
    }
  };

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

    const taskBankIdSet = new Set<string>();
    const localBanksToSend: any[] = [];

    const selectedEntries = uploadedData.features
      .map((feature: any, originalIndex: number) => {
        const selectionId = getShoreLineIdFromFeature(feature, originalIndex);
        return { feature, originalIndex, selectionId };
      })
      .filter((x) => selectedLines.has(x.selectionId));

    const selectionIdToBankBaseId = new Map<string, { fromBackend: boolean; base: string }>();

    selectedEntries.forEach(({ feature, selectionId }, selectedIndex) => {
      const props = feature?.properties || {};
      const fromBackend = isFromBackendFeature(feature);

      const baseIdInTask = getShoreLineIdFromFeature(feature, selectedIndex);
      const baseBackendBankId = fromBackend
        ? String(props.bank_id || props.bankId || baseIdInTask)
        : `${taskId}-${baseIdInTask}`;
      selectionIdToBankBaseId.set(selectionId, { fromBackend, base: baseBackendBankId });

      const baseName = String(props.bank_name || props.bankName || props.name || selectionId);
      const regionCode = String(props.region_code || props.regionCode || 'Mzs');
      const reversed = !!(props && (props.reversed === true || props.reversed === 'true'));
      const description = String(props.description || '');

      if (fromBackend) {
        taskBankIdSet.add(baseBackendBankId);
        return;
      }

      const parts = toLineStrings(feature?.geometry);
      parts.forEach((geom, partIndex) => {
        const suffix = parts.length > 1 ? `_part${partIndex + 1}` : '';
        const bankId = `${baseBackendBankId}${suffix}`;
        const bankName = parts.length > 1 ? `${baseName}_${partIndex + 1}` : baseName;
        taskBankIdSet.add(bankId);
        localBanksToSend.push({
          bank_id: String(bankId),
          bank_name: bankName,
          region_code: regionCode,
          geometry: geom,
          bank_geometry: geom,
          reversed,
          description,
        });
      });
    });

    if (taskBankIdSet.size === 0) {
      alert('所选岸段中没有可用的 LineString / MultiLineString，无法创建任务');
      return;
    }

    if (!params.skipUploadBanks) {
      await ensureBanksUploaded(localBanksToSend);
    } else {
      console.info('跳过上传岸段（skipUploadBanks=true）');
    }

    const selectedBankIds: string[] = Array.from(taskBankIdSet);

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

    uploadedData.features.forEach((feature: any, index: number) => {
      const shoreLineId = getShoreLineIdFromFeature(feature, index);
      if (!selectedLines.has(shoreLineId)) return;

      const mapped = selectionIdToBankBaseId.get(shoreLineId);
      const fromBackend = mapped?.fromBackend ?? isFromBackendFeature(feature);
      const baseBackendBankId =
        mapped?.base ??
        (fromBackend
          ? String(feature?.properties?.bank_id || feature?.properties?.bankId || shoreLineId)
          : `${taskId}-${shoreLineId}`);
      const reverseFlag = !!(
        feature.properties &&
        ((feature.properties as any).reversed === true || (feature.properties as any).reversed === 'true')
      );

      const applyReverseFlag = (featureCollection: any) => {
        if (!reverseFlag) return;
        featureCollection.features.forEach((f: any) => {
          if (f.geometry && Array.isArray(f.geometry.coordinates)) {
            f.geometry.coordinates = (f.geometry.coordinates as any[]).slice().reverse();
          }
          if (f.properties) {
            const lp = f.properties.leftPoint;
            const rp = f.properties.rightPoint;
            f.properties.leftPoint = rp;
            f.properties.rightPoint = lp;
          }
        });
      };

      const applyCommonProps = (featureCollection: any, bankIdToUse: string) => {
        featureCollection.features.forEach((f: any) => {
          if (!f.properties) f.properties = {};
          (f.properties as any).shoreLineIndex = index;
          (f.properties as any).shoreLineId = shoreLineId;
          (f.properties as any).bank_id = bankIdToUse;
        });
      };

      const maybeExtend = (f: GeoJSON.Feature<GeoJSON.LineString>) => {
        if (!params.extendToFirstShorelineIntersection) return f;
        return extendCrossLineToFirstShorelineIntersection({
          crossLine: f,
          shoreLineId,
          uploadedData,
          maxRayLengthMeters: 10000,
        });
      };

      if (feature.geometry.type === 'LineString') {
        const line = feature as GeoJSON.Feature<GeoJSON.LineString>;
        const lineLengthMeters = turf.length(line, { units: 'meters' });

        const { featureCollection } = generatePerpendicularLines(line, 0, lineLengthMeters, globalInterval, globalLength);

        const bankIdToUse = baseBackendBankId;
        applyReverseFlag(featureCollection);
        applyCommonProps(featureCollection, bankIdToUse);

        const extended = (featureCollection.features as any[])
          .map((ff) => maybeExtend(ff))
          .filter(Boolean) as GeoJSON.Feature<GeoJSON.LineString>[];

        allPerpendicularLines.push(...extended);
      } else if (feature.geometry.type === 'MultiLineString') {
        const multiLine = feature.geometry as GeoJSON.MultiLineString;
        multiLine.coordinates.forEach((coords, partIndex) => {
          if (!Array.isArray(coords) || coords.length < 2) return;
          const line = turf.lineString(coords) as GeoJSON.Feature<GeoJSON.LineString>;
          const lineLengthMeters = turf.length(line, { units: 'meters' });

          const { featureCollection } = generatePerpendicularLines(line, 0, lineLengthMeters, globalInterval, globalLength);

          const bankIdToUse = fromBackend ? baseBackendBankId : `${baseBackendBankId}_part${partIndex + 1}`;
          applyReverseFlag(featureCollection);
          applyCommonProps(featureCollection, bankIdToUse);

          const extended = (featureCollection.features as any[])
            .map((ff) => maybeExtend(ff))
            .filter(Boolean) as GeoJSON.Feature<GeoJSON.LineString>[];

          allPerpendicularLines.push(...extended);
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
        bank_id: props.bank_id || props.shoreLineId || 'line-0',
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
        bank_id: props.bank_id,
        leftPoint: props.leftPoint,
        rightPoint: props.rightPoint,
        extended_to_shoreline: props.extended_to_shoreline,
        extended_length_m: props.extended_length_m,
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
      // no-op
    }

    setPerpendicularData(turf.featureCollection(allPerpendicularLines));
    setShowCrossLines(true);

    const modeLabel = params.extendToFirstShorelineIntersection ? '计算断面' : '精细断面';
    alert(`任务创建成功！\n已为 ${selectedLines.size} 个岸段生成 ${allPerpendicularLines.length} 条${modeLabel}！`);
  } catch (err: any) {
    console.error('生成断面失败:', err);
    alert(`生成断面失败: ${err.message}`);
  }
}

export async function generateSectionsAndCreateTask(params: {
  uploadedData: GeoJSON.FeatureCollection;
  selectedLines: Set<string>;
  globalInterval: number;
  globalLength: number;
  globalProperties: SectionParams | null;
  setPerpendicularData: (v: GeoJSON.FeatureCollection | null) => void;
  setShowCrossLines: (v: boolean) => void;
  setGlobalProperties: (v: SectionParams | null) => void;
  // 若为 true，则在生成断面前不将本地岸段同步上传到后端
  skipUploadBanks?: boolean;
}) {
  await generateSectionsAndCreateTaskCore({
    ...params,
    extendToFirstShorelineIntersection: false,
  });
}

export async function generateComputeSectionsAndCreateTask(params: {
  uploadedData: GeoJSON.FeatureCollection;
  selectedLines: Set<string>;
  globalInterval: number;
  globalLength: number;
  globalProperties: SectionParams | null;
  setPerpendicularData: (v: GeoJSON.FeatureCollection | null) => void;
  setShowCrossLines: (v: boolean) => void;
  setGlobalProperties: (v: SectionParams | null) => void;
  skipUploadBanks?: boolean;
}) {
  await generateSectionsAndCreateTaskCore({
    ...params,
    extendToFirstShorelineIntersection: true,
  });
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
