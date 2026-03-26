import { useEffect, useRef, useState } from 'react';
import * as turf from '@turf/turf';
import '../App.css';
import type { SectionParams } from '../types/sections';
import SectionPropertiesModal from '../components/SectionPropertiesModal';
import EditorSidebar from '../components/EditorSidebar';
import EditorMap from '../components/EditorMap';
import { setCurrentBasicParamId } from '../services/basicParamsService';
import type { SelectionGroup } from '../types/selection';
import {
  configureSelectedCrossLinePropertiesAction,
  createCrossLineAtPointAction,
  createCrossLineByEndpointsAction,
  deleteSelectedCrossLineAction,
  persistCrossLineGeometryAction,
  rotateCrossLineGeometry,
  reverseCrossLinesInGroupAction,
  reverseSelectedCrossLineAction,
  scaleCrossLineGeometry,
  translateSelectedCrossLineAction,
} from './editor/crossLineActions';
import { applyCustomSegmentsAction } from './editor/customSegments';
import {
  exportSectionsSampleAction,
  uploadMainGeoJsonAction,
  uploadSectionsGeoJsonAndCreateTaskAction,
} from './editor/fileActions';
import { generateSectionsAndCreateTask, runCurrentTask } from './editor/sectionsGeneration';
import { fetchBasicParamDetailAsSectionParams, fetchBasicParamsList } from './editor/basicParamsApi';
import { getCurrentTaskId } from './editor/taskState';

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
  const [globalLength, setGlobalLength] = useState<number>(1000);
  
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

  // 岸段组（后端 banks 按 region_code 分组）
  const [bankGroups, setBankGroups] = useState<Array<{ region_code: string; count: number }>>([]);
  const [selectedBankGroup, setSelectedBankGroup] = useState<string>('');
  // 当前可选的岸段列表（按 bank_id）
  const [bankList, setBankList] = useState<any[]>([]);
  
  // 新增状态：控制断面选择模式
  const [isSelectingCrossLines, setIsSelectingCrossLines] = useState<boolean>(false);

  // 岸段方向修正：对已选岸段逐条点击，批量反转该岸段上的断面，并标记岸段 properties.reversed=true
  const [isFixingShoreLineReversed, setIsFixingShoreLineReversed] = useState<boolean>(false);

  // 新增状态：断面编辑控制模式（岸段线/自由）
  const [crossLineControlMode, setCrossLineControlMode] = useState<'shoreline' | 'free'>('shoreline');
  
  // 新增状态：断面编辑模式
  // - 'none': 不进行选择/添加（用于“释放选择”）
  // - 'select': 选择现有断面
  // - 'add': 新建断面
  const [crossLineEditMode, setCrossLineEditMode] = useState<'none' | 'select' | 'add'>('none');
  
  // 新增状态：选中的断面索引
  const [selectedCrossLineIndex, setSelectedCrossLineIndex] = useState<number | null>(null);

  // 断面验证：避免重复触发校验
  const validationTriggeredRef = useRef<Set<string>>(new Set());

  const getShoreLineId = (feature: any, index: number) => {
    const p = feature?.properties || {};
    return String(p.bank_id || p.bankId || `line-${index}`);
  };

  const patchSectionValidationProps = (sectionId: string, patch: Record<string, any>) => {
    setPerpendicularData((prev) => {
      if (!prev) return prev;
      const features = [...prev.features] as any[];
      let changed = false;

      for (let i = 0; i < features.length; i++) {
        const f = features[i];
        const sid = f?.properties?.sectionId;
        if (!sid || sid !== sectionId) continue;

        features[i] = {
          ...f,
          properties: {
            ...(f.properties || {}),
            ...patch,
          },
        };
        changed = true;
      }

      return changed ? turf.featureCollection(features as any) : prev;
    });
  };

  const validateSectionAsync = async (sectionId: string): Promise<'valid' | 'invalid' | 'pending'> => {
    try {
      const res = await fetch(`/v0/bank/sections/${sectionId}/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}`);
      }

      let data: any = null;
      try {
        data = await res.json();
      } catch {
        // 后端若没有返回 JSON，则保持 pending（黄色）
        data = null;
      }

      const rawIsValid = data?.is_valid ?? data?.isValid;
      const rawStatus = data?.validation_status ?? data?.validationStatus;
      const validationMessage = data?.validation_message ?? data?.validationMessage;

      const isValid: boolean | undefined =
        rawIsValid === true ? true : rawIsValid === false ? false : undefined;

      const normalizedStatus: string | undefined =
        typeof rawStatus === 'string' ? String(rawStatus).toLowerCase() : undefined;

      // 只有真正通过/不通过才变色：其它任何状态（含未知字符串）都视为 pending
      let mappedStatus: 'valid' | 'invalid' | 'pending' = 'pending';
      if (isValid === true) mappedStatus = 'valid';
      else if (isValid === false) mappedStatus = 'invalid';
      else if (normalizedStatus === 'valid') mappedStatus = 'valid';
      else if (normalizedStatus === 'invalid' || (normalizedStatus && normalizedStatus.startsWith('invalid'))) {
        mappedStatus = 'invalid';
      }

      patchSectionValidationProps(sectionId, {
        is_valid: isValid,
        validation_status: mappedStatus,
        validation_status_raw: normalizedStatus,
        validation_message: validationMessage,
        validation_error: undefined,
        validated_at: Date.now(),
      });

      return mappedStatus;
    } catch (err: any) {
      console.warn(`断面验证请求失败: ${sectionId}`, err);
      // 请求失败不变红，保持黄色 pending；下次可手动刷新或重试
      patchSectionValidationProps(sectionId, {
        validation_status: 'pending',
        is_valid: undefined,
        validation_status_raw: undefined,
        validation_error: err?.message || String(err),
      });

      return 'pending';
    }
  };

  // 手动触发断面校验：强制重跑一遍（即使已校验过），避免编辑移动后状态滞后
  const validateAllPendingSections = async () => {
    if (!perpendicularData || perpendicularData.features.length === 0) {
      alert('当前没有可检查的断面');
      return;
    }

    const sectionIds = new Set<string>();
    let hasMissingSectionId = false;
    (perpendicularData.features as any[]).forEach((f) => {
      const sid = f?.properties?.sectionId as string | undefined;
      if (!sid) {
        hasMissingSectionId = true;
        return;
      }
      sectionIds.add(sid);
    });

    if (sectionIds.size === 0) {
      alert('当前没有可校验的断面（缺少 sectionId）');
      return;
    }

    sectionIds.forEach((sid) => {
      patchSectionValidationProps(sid, {
        validation_status: 'pending',
        is_valid: undefined,
        validation_status_raw: undefined,
        validation_message: undefined,
        validation_error: undefined,
        validated_at: Date.now(),
      });
    });

    // 强制重跑：不受 validationTriggeredRef 的影响
    await Promise.allSettled(Array.from(sectionIds).map((sid) => validateSectionAsync(sid)));

    if (hasMissingSectionId) {
      console.warn('存在缺少 sectionId 的断面，无法参与后端校验');
    }
  };

  const validateAllSectionsBeforeAnalysis = async (): Promise<{ ok: boolean; reason?: string }> => {
    if (!perpendicularData || perpendicularData.features.length === 0) {
      return { ok: false, reason: '请先绘制断面' };
    }

    const sectionIds = new Set<string>();
    let missingSectionIdCount = 0;

    (perpendicularData.features as any[]).forEach((f) => {
      const sid = f?.properties?.sectionId as string | undefined;
      if (!sid) {
        missingSectionIdCount++;
        return;
      }
      sectionIds.add(sid);
    });

    if (missingSectionIdCount > 0) {
      return { ok: false, reason: `存在 ${missingSectionIdCount} 个断面缺少 sectionId，无法校验` };
    }
    if (sectionIds.size === 0) {
      return { ok: false, reason: '没有可校验的断面' };
    }

    // 分析前强制校验一遍，避免断面被编辑移动后状态滞后
    sectionIds.forEach((sid) => {
      patchSectionValidationProps(sid, {
        validation_status: 'pending',
        is_valid: undefined,
        validation_status_raw: undefined,
        validation_message: undefined,
        validation_error: undefined,
        validated_at: Date.now(),
      });
    });

    const results = await Promise.allSettled(Array.from(sectionIds).map((sid) => validateSectionAsync(sid)));
    const mapped = results.map((r) => (r.status === 'fulfilled' ? r.value : 'pending'));
    const allValid = mapped.every((st) => st === 'valid');
    if (!allValid) {
      return { ok: false, reason: '存在未通过或未完成校验的断面，请先修正后再分析' };
    }

    return { ok: true };
  };

  // 当断面集合变化时，自动异步触发后端验证
  useEffect(() => {
    if (!perpendicularData || perpendicularData.features.length === 0) return;

    const sectionIdsToValidate: string[] = [];
    (perpendicularData.features as any[]).forEach((f) => {
      const sectionId = f?.properties?.sectionId as string | undefined;
      if (!sectionId) return;

      if (validationTriggeredRef.current.has(sectionId)) return;
      validationTriggeredRef.current.add(sectionId);
      sectionIdsToValidate.push(sectionId);

      // 初始标记为 pending（黄色）
      if (!f?.properties?.validation_status) {
        patchSectionValidationProps(sectionId, { validation_status: 'pending' });
      }
    });

    if (sectionIdsToValidate.length === 0) return;
    sectionIdsToValidate.forEach((sid) => {
      validateSectionAsync(sid);
    });
  }, [perpendicularData]);

  // 挂载时拉取可用的基础参数模板列表
  useEffect(() => {
    const fetchBasicParams = async () => {
      try {
        const list = await fetchBasicParamsList();
        setBasicParamsList(list);
        console.log('拉取到的基础参数模板列表:', list);

        if (list.length > 0) {
          const first: any = list[0];
          const paramId = first.param_id ?? first.id ?? null;
          if (paramId !== null) {
            setSelectedBasicParamIdState(String(paramId));
            setCurrentBasicParamId(first.id ?? null);
          }
        }
      } catch (err) {
        console.warn('加载基础参数模板列表出错:', err);
      }
    };

    fetchBasicParams();
  }, []);

  const fetchBankGroups = async () => {
    try {
      // 目前岸段仅使用：GET /v0/bank/banks?region_code=...
      const res = await fetch('/v0/bank/banks?region_code=Mzs');
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}`);
      }
      const data = await res.json();
      const banks = (data?.banks || data?.data || data) as any[];
      const list = Array.isArray(banks) ? banks : [];

      setBankGroups([{ region_code: 'Mzs', count: list.length }]);
      setBankList(list);
    } catch (err) {
      console.error('获取岸段组失败:', err);
      setBankGroups([]);
    }
  };

  const loadBankById = async (bankId: string) => {
    if (!bankId) return;
    try {
      // 尝试按 REST 资源路径获取单条
      let res = await fetch(`/v0/bank/banks/${encodeURIComponent(bankId)}`);
      if (!res.ok) {
        // 退回到查询参数形式
        res = await fetch(`/v0/bank/banks?bank_id=${encodeURIComponent(bankId)}`);
      }
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      const bank = (data?.bank || data?.banks?.[0] || data?.data || data) as any;
      const b = Array.isArray(bank) ? bank[0] : bank;
      if (!b || !b.geometry) {
        alert('未找到指定的岸段或该岸段无几何数据');
        return;
      }

      const newFeature = {
        type: 'Feature' as const,
        geometry: b.geometry,
        properties: {
          index: uploadedData ? uploadedData.features.length : 0,
          bank_id: b.bank_id,
          bank_name: b.bank_name,
          region_code: b.region_code,
          reversed: !!(b?.reversed === true || b?.reversed === 'true'),
          description: b.description,
        },
      } as any;

      // 如果已存在相同 bank_id，避免重复加载
      const exists = uploadedData?.features.some((f: any) => {
        const p = f?.properties || {};
        return String(p.bank_id || p.bankId || '') === String(b.bank_id);
      });
      if (exists) {
        alert(`岸段 ${b.bank_id} 已在编辑器中，已跳过重复加载`);
        return;
      }

      setUploadedData((prev) => {
        if (!prev) return { type: 'FeatureCollection', features: [newFeature] } as any;
        const next = { ...prev, features: [...prev.features, newFeature] } as any;
        return next;
      });

      // 不清空现有选择，允许多条岸段共存。仅将编辑模式调整为默认关闭，避免干扰当前操作。
      setIsSelectingShoreLines(false);
      setIsSelectingStartEnd(false);
      setIsSelectingCrossLines(false);
      setIsFixingShoreLineReversed(false);
      setCrossLineEditMode('none');
    } catch (err: any) {
      console.error('加载岸段失败:', err);
      alert(`加载岸段失败: ${err?.message || String(err)}`);
    }
  };

  const deleteBankById = async (bankId: string) => {
    if (!bankId) return;
    const ok = window.confirm(`确认删除岸段 bank_id=${bankId} ?`);
    if (!ok) return;

    try {
      const res = await fetch(`/v0/bank/banks/${encodeURIComponent(bankId)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      alert('已删除岸段');
      setSelectedBankGroup('');
      // 同步从前端已加载的要素中移除该 bank
      setUploadedData((prev) => {
        if (!prev) return prev;
        const features = (prev.features || []).filter((f: any) => {
          const p = f?.properties || {};
          return String(p.bank_id || p.bankId || '') !== String(bankId);
        });
        return { ...prev, features } as any;
      });
      await fetchBankGroups();
    } catch (err: any) {
      console.error('删除岸段失败:', err);
      alert(`删除岸段失败: ${err?.message || String(err)}`);
    }
  };

  const loadBankGroup = async (regionCode: string) => {
    if (!regionCode) return;
    try {
      const res = await fetch(`/v0/bank/banks?region_code=${encodeURIComponent(regionCode)}`);
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}`);
      }
      const data = await res.json();
      const banks = (data?.banks || data?.data || data) as any[];
      const list = Array.isArray(banks) ? banks : [];

      const features = list
        .filter((b) => b?.geometry)
        .map((b, index) => ({
          type: 'Feature' as const,
          geometry: b.geometry,
          properties: {
            index,
            bank_id: b.bank_id,
            bank_name: b.bank_name,
            region_code: b.region_code,
            reversed: !!(b?.reversed === true || b?.reversed === 'true'),
            description: b.description,
          },
        }));

      setUploadedData({ type: 'FeatureCollection', features } as any);
      setSelectedLines(new Set());
      setIsSelectingShoreLines(false);
      setIsSelectingStartEnd(false);
      setIsSelectingCrossLines(false);
      setIsFixingShoreLineReversed(false);
      setCrossLineEditMode('none');
      setSelectedCrossLineIndex(null);
    } catch (err: any) {
      console.error('加载岸段组失败:', err);
      alert(`加载岸段组失败: ${err?.message || String(err)}`);
    }
  };

  const deleteBankGroup = async () => {
    if (!selectedBankGroup) {
      alert('请先选择要删除的岸段组');
      return;
    }
    const ok = window.confirm(`确认删除岸段组 region_code=${selectedBankGroup} 下的全部岸段？`);
    if (!ok) return;

    try {
      const res = await fetch(`/v0/bank/banks?region_code=${encodeURIComponent(selectedBankGroup)}`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      const banks = (data?.banks || data?.data || data) as any[];
      const list = Array.isArray(banks) ? banks : [];
      const ids = list.map((b) => b?.bank_id).filter(Boolean) as string[];
      if (ids.length === 0) {
        alert('该组下没有可删除的岸段');
        return;
      }

      const results = await Promise.allSettled(
        ids.map((id) => fetch(`/v0/bank/banks/${encodeURIComponent(id)}`, { method: 'DELETE' })),
      );
      const okCount = results.filter((r) => r.status === 'fulfilled' && (r.value as any).ok).length;
      const failCount = results.length - okCount;
      if (failCount > 0) {
        alert(`删除完成：成功 ${okCount}，失败 ${failCount}`);
      } else {
        alert(`已删除 ${okCount} 条岸段`);
      }

      setSelectedBankGroup('');
      await fetchBankGroups();
    } catch (err: any) {
      console.error('删除岸段组失败:', err);
      alert(`删除岸段组失败: ${err?.message || String(err)}`);
    }
  };

  // 挂载时拉取岸段组列表（用于下拉框）
  useEffect(() => {
    fetchBankGroups();
  }, []);

  // 当用户选择模板时，拉取模板详情并设置为全局属性
  const handleSelectBasicParam = async (paramIdStr: string | null) => {
    if (!paramIdStr) {
      setSelectedBasicParamIdState(null);
      setCurrentBasicParamId(null);
      setGlobalProperties(null);
      return;
    }

    try {
      const { numericId, sectionParams } = await fetchBasicParamDetailAsSectionParams(paramIdStr);
      setGlobalProperties(sectionParams);
      setSelectedBasicParamIdState(paramIdStr);
      setCurrentBasicParamId(numericId);
    } catch (err) {
      console.warn('加载模板详情失败:', err);
    }
  };

  // 反转选中的断面（交换端点并同步到后端如果存在）
  const reverseSelectedCrossLine = async () => {
    await reverseSelectedCrossLineAction({
      selectedCrossLineIndex,
      perpendicularData,
      setPerpendicularData,
    });
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
  
  // 全选或取消全选所有岸段
  const toggleSelectAllShoreLines = () => {
    if (!uploadedData) {
      alert('请先上传 GeoJSON 数据');
      return;
    }
    
    // 如果当前已经全选了（选中数量等于可选线要素数量），则清空
    const selectableIds: string[] = [];
    uploadedData.features.forEach((f: any, index: number) => {
      if (f?.geometry?.type === 'LineString' || f?.geometry?.type === 'MultiLineString') {
        selectableIds.push(getShoreLineId(f, index));
      }
    });

    if (selectedLines.size === selectableIds.length && selectableIds.length > 0) {
      setSelectedLines(new Set());
    } else {
      setSelectedLines(new Set(selectableIds));
    }
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
    const next = !isSelectingCrossLines;
    setIsSelectingCrossLines(next);

    if (next) {
      if (isSelectingShoreLines) setIsSelectingShoreLines(false);
      if (isSelectingStartEnd) setIsSelectingStartEnd(false);
      // 进入精调时默认不选中任何工具，避免误触
      setCrossLineEditMode('none');
      setSelectedCrossLineIndex(null);
    } else {
      // 退出精调时取消所有选择并释放断面
      setSelectedCrossLineIndex(null);
      setCrossLineEditMode('none');
      setCrossLineControlMode('shoreline');
    }
  };

  const clearSelectedCrossLineSelection = () => {
    setSelectedCrossLineIndex(null);
  };

  const toggleFixShoreLineReversed = () => {
    setIsFixingShoreLineReversed((prev) => {
      const next = !prev;
      if (next) {
        // 开启修正时，退出其它编辑/选择模式，避免点击冲突
        setIsSelectingShoreLines(false);
        setIsSelectingStartEnd(false);
        setIsSelectingCrossLines(false);
        setCrossLineEditMode('none');
        setSelectedCrossLineIndex(null);
      }
      return next;
    });
  };

  const fixSelectedShoreLineReversed = async (params: { shoreLineIndex: number; shoreLineId: string }) => {
    const { shoreLineIndex, shoreLineId } = params;

    if (!uploadedData) {
      alert('未加载岸段数据');
      return;
    }

    if (!perpendicularData || perpendicularData.features.length === 0) {
      alert('请先生成断面后再修正');
      return;
    }

    if (!selectedLines.has(shoreLineId)) {
      alert('修正仅对已选岸段生效');
      return;
    }

    const targetFeature: any = uploadedData.features?.[shoreLineIndex];
    const alreadyReversed =
      !!(targetFeature?.properties && (targetFeature.properties.reversed === true || targetFeature.properties.reversed === 'true'));
    if (alreadyReversed) {
      alert('该岸段已标记为 reversed=true，已跳过');
      return;
    }

    const updatedFeatures = [...(perpendicularData.features as any[])];
    const reversedIndices: number[] = [];

    updatedFeatures.forEach((f, idx) => {
      const props = f?.properties || {};
      if (props.shoreLineId !== shoreLineId) return;
      if (f?.geometry?.type !== 'LineString') return;
      const coords = (f.geometry.coordinates as any[]) || [];
      if (coords.length < 2) return;

      const nextProps: any = { ...props };
      if (nextProps.leftPoint && nextProps.rightPoint) {
        const oldLeft = nextProps.leftPoint;
        nextProps.leftPoint = nextProps.rightPoint;
        nextProps.rightPoint = oldLeft;
      }

      updatedFeatures[idx] = {
        ...f,
        geometry: {
          type: 'LineString',
          coordinates: [...coords].reverse(),
        },
        properties: nextProps,
      };

      reversedIndices.push(idx);
    });

    if (reversedIndices.length === 0) {
      alert('该岸段下未找到可反转的断面');
      return;
    }

    setPerpendicularData(turf.featureCollection(updatedFeatures as any));

    // 标记岸段 reversed=true（用于后续重新生成断面时保持方向一致）
    setUploadedData((prev) => {
      if (!prev) return prev;
      const next = { ...prev, features: [...prev.features] } as any;
      const feat: any = next.features?.[shoreLineIndex];
      if (!feat) return next;
      feat.properties = { ...(feat.properties || {}), reversed: true };
      return next;
    });

    const sectionsToSync = reversedIndices
      .map((idx) => {
        const f: any = updatedFeatures[idx];
        return f?.properties?.sectionId as string | undefined;
      })
      .filter(Boolean) as string[];

    if (sectionsToSync.length === 0) {
      alert(`已修正岸段 ${shoreLineId}：反转 ${reversedIndices.length} 条断面（未同步到后端）`);
      return;
    }

    const results = await Promise.allSettled(
      sectionsToSync.map((sectionId) =>
        fetch(`/v0/bank/sections/${sectionId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reverse: true }),
        }).then((res) => {
          if (!res.ok) throw new Error(res.statusText);
          return true;
        }),
      ),
    );

    const successCount = results.filter((r) => r.status === 'fulfilled').length;
    const failedCount = results.length - successCount;

    if (failedCount > 0) {
      alert(
        `已修正岸段 ${shoreLineId}：反转 ${reversedIndices.length} 条断面；后端同步成功 ${successCount}，失败 ${failedCount}`,
      );
    } else {
      alert(`已修正岸段 ${shoreLineId}：反转 ${reversedIndices.length} 条断面（已同步到后端）`);
    }
  };

  const sendSelectedShoreLinesGeoJson = async () => {
    if (!uploadedData) {
      alert('未加载岸段数据');
      return;
    }
    if (selectedLines.size === 0) {
      alert('请先选择用于生成断面的岸段');
      return;
    }

    const selectedFeatures = uploadedData.features
      .map((f: any, index: number) => ({ f, index }))
      .filter(({ f, index }) => selectedLines.has(getShoreLineId(f, index)))
      .map(({ f }) => f);

    const toLineStrings = (geometry: any): Array<{ type: 'LineString'; coordinates: any[] }> => {
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
    };

    const banksToSend: any[] = [];
    const currentTaskId = getCurrentTaskId();
    const taskPrefix = currentTaskId ? `${currentTaskId}-` : '';
    selectedFeatures.forEach((f: any, index: number) => {
      const props = f?.properties || {};
      const baseId = getShoreLineId(f, index);
      const baseName = String(props.bank_name || props.bankName || props.name || baseId);
      const regionCode = String(props.region_code || props.regionCode || 'Mzs');
      const reversed = !!(props && (props.reversed === true || props.reversed === 'true'));
      const description = String(props.description || '');

      const parts = toLineStrings(f?.geometry);
      parts.forEach((geom, partIndex) => {
        const suffix = parts.length > 1 ? `_part${partIndex + 1}` : '';
        const bankId = `${taskPrefix}${baseId}${suffix}`;
        const bankName = parts.length > 1 ? `${baseName}_${partIndex + 1}` : baseName;
        banksToSend.push({
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

    if (banksToSend.length === 0) {
      alert('没有可发送的岸段（仅支持 LineString / MultiLineString）');
      return;
    }

    try {
      const results: Array<{ bank_id: string; ok: boolean; status?: number; message?: string }> = [];

      for (const bank of banksToSend) {
        const payload = { banks: [bank], overwrite: false };
        try {
          console.log('POST /v0/bank/banks payload for', bank.bank_id, JSON.stringify(payload, null, 2));
        } catch (e) {
          console.log('POST /v0/bank/banks payload for', bank.bank_id, payload);
        }
        const res = await fetch('/v0/bank/banks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const t = await res.text();
          results.push({
            bank_id: String(bank.bank_id),
            ok: false,
            status: res.status,
            message: `${res.status} ${res.statusText} ${t}`,
          });
        } else {
          results.push({ bank_id: String(bank.bank_id), ok: true, status: res.status });
        }
      }

      const okCount = results.filter((r) => r.ok).length;
      const fail = results.filter((r) => !r.ok);

      if (fail.length > 0) {
        const first = fail[0];
        console.error('发送岸段失败明细:', fail);
        alert(`发送完成：成功 ${okCount}，失败 ${fail.length}。首个失败 bank_id=${first.bank_id}：${first.message}`);
      } else {
        alert(`已成功发送 ${okCount} 条岸段到后端`);
      }

      await fetchBankGroups();
    } catch (err: any) {
      console.error('发送岸段到 /v0/bank/banks 失败:', err);
      alert(`发送岸段失败: ${err?.message || String(err)}`);
    }
  };
  
  // 在指定位置新建断面
  const createCrossLineAtPoint = async (line: GeoJSON.Feature<GeoJSON.LineString>, distanceOnLine: number) => {
    await createCrossLineAtPointAction({
      line,
      distanceOnLine,
      globalLength,
      perpendicularData,
      globalProperties,
      setGlobalProperties,
      setPerpendicularData,
    });
  };
  
  // 删除选中的断面
  const deleteSelectedCrossLine = async () => {
    await deleteSelectedCrossLineAction({
      selectedCrossLineIndex,
      perpendicularData,
      setPerpendicularData,
      setSelectedCrossLineIndex,
    });
  };
  
  // 平移选中的断面
  const translateSelectedCrossLine = async (offsetMeters: number) => {
    await translateSelectedCrossLineAction({
      offsetMeters,
      selectedCrossLineIndex,
      perpendicularData,
      uploadedData,
      setPerpendicularData,
    });
  };

  // 仅更新前端断面几何（用于自由模式拖动/旋转/缩放的即时反馈）
  const updateCrossLineGeometryLocal = (crossLineIndex: number, geometry: GeoJSON.LineString) => {
    setPerpendicularData((prev) => {
      if (!prev) return prev;
      const features = [...prev.features] as GeoJSON.Feature<GeoJSON.Geometry>[];
      const current: any = features[crossLineIndex];
      if (!current || current.geometry?.type !== 'LineString') return prev;

      const coords = geometry.coordinates as number[][];
      if (!coords || coords.length < 2) return prev;

      const leftPoint = coords[0];
      const rightPoint = coords[coords.length - 1];

      features[crossLineIndex] = {
        ...current,
        geometry,
        properties: {
          ...(current.properties || {}),
          crossLineId: (current.properties as any)?.crossLineId ?? crossLineIndex,
          leftPoint,
          rightPoint,
        },
      };

      return turf.featureCollection(features as any);
    });
  };

  // 将断面几何同步到后端（自由模式拖动结束时调用）
  const persistCrossLineGeometry = async (crossLineIndex: number, geometry: GeoJSON.LineString) => {
    const feature: any = perpendicularData?.features?.[crossLineIndex];
    const sectionId = feature?.properties?.sectionId as string | undefined;
    await persistCrossLineGeometryAction({ sectionId, geometry, silent: true });
  };

  // 自由模式：旋转选中断面
  const rotateSelectedCrossLine = async (angleDegrees: number) => {
    if (selectedCrossLineIndex === null || !perpendicularData) {
      alert('请先选择要旋转的断面');
      return;
    }
    const feature: any = perpendicularData.features[selectedCrossLineIndex];
    if (!feature || feature.geometry?.type !== 'LineString') return;

    const nextGeometry = rotateCrossLineGeometry({
      geometry: feature.geometry as GeoJSON.LineString,
      angleDegrees,
    });

    updateCrossLineGeometryLocal(selectedCrossLineIndex, nextGeometry);
    await persistCrossLineGeometry(selectedCrossLineIndex, nextGeometry);
  };

  // 自由模式：拉长/缩短选中断面
  const scaleSelectedCrossLine = async (deltaMeters: number) => {
    if (selectedCrossLineIndex === null || !perpendicularData) {
      alert('请先选择要缩放的断面');
      return;
    }
    const feature: any = perpendicularData.features[selectedCrossLineIndex];
    if (!feature || feature.geometry?.type !== 'LineString') return;

    const nextGeometry = scaleCrossLineGeometry({
      geometry: feature.geometry as GeoJSON.LineString,
      deltaMeters,
    });

    updateCrossLineGeometryLocal(selectedCrossLineIndex, nextGeometry);
    await persistCrossLineGeometry(selectedCrossLineIndex, nextGeometry);
  };

  // 自由模式：点选起止点创建断面
  const createCrossLineByEndpoints = async (start: number[], end: number[]) => {
    await createCrossLineByEndpointsAction({
      start,
      end,
      uploadedData,
      perpendicularData,
      setPerpendicularData,
    });
  };
  
  // 为选中的断面配置属性
  const configureSelectedCrossLineProperties = async () => {
    await configureSelectedCrossLinePropertiesAction({
      selectedCrossLineIndex,
      perpendicularData,
      setEditingPropertiesGroupId,
    });
  };

  // 核心逻辑：基于上传的 GeoJSON 和全局配置生成所有垂线
  const handleGenerateSections = async () => {
    if (!uploadedData) {
      alert('请先上传 GeoJSON 数据');
      return;
    }
    await generateSectionsAndCreateTask({
      uploadedData,
      selectedLines,
      globalInterval,
      globalLength,
      globalProperties,
      setPerpendicularData,
      setShowCrossLines,
      setGlobalProperties,
    });
  };

  // 开始分析：运行任务中的所有断面
  const handleStartAnalysis = async () => {
    if (!perpendicularData) {
      alert('请先绘制断面');
      return;
    }

    const check = await validateAllSectionsBeforeAnalysis();
    if (!check.ok) {
      alert(check.reason || '断面校验未通过，已拒绝执行分析');
      return;
    }

    await runCurrentTask({ perpendicularData });
  };

  // 应用自定义线段配置：更新当前编辑组的垂线
  const handleApplyCustomSegments = () => {
    applyCustomSegmentsAction({
      editingGroupId,
      groups,
      perpendicularData,
      globalLength,
      globalProperties,
      setGroups,
      setPerpendicularData,
    });
  };

  // 处理文件上传
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    uploadMainGeoJsonAction({
      e,
      setUploadedData,
      setSelectedLines,
      setIsSelectingShoreLines,
      setIsSelectingStartEnd,
    });
  };

  // 上传已有断面几何并直接创建任务与断面
  const handleSectionsFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    await uploadSectionsGeoJsonAndCreateTaskAction({
      e,
      setPerpendicularData,
      setShowCrossLines,
    });
  };

  // 导出当前断面的几何信息（用于上传断面功能的样例）
  const handleExportSections = () => {
    exportSectionsSampleAction({ perpendicularData });
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

  // 反切某段落范围内的所有断面
  const reverseCrossLinesInGroup = async (groupId: string) => {
    const group = groups.find((g) => g.id === groupId);
    if (!group) {
      alert('未找到要反切的段落');
      return;
    }

    await reverseCrossLinesInGroupAction({
      group,
      perpendicularData,
      globalLength,
      setPerpendicularData,
    });
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
        isFixingShoreLineReversed={isFixingShoreLineReversed}
        onFixSelectedShoreLineReversed={fixSelectedShoreLineReversed}
        isSelectingShoreLines={isSelectingShoreLines}
        isSelectingStartEnd={isSelectingStartEnd}
        isSelectingCrossLines={isSelectingCrossLines}
        crossLineControlMode={crossLineControlMode}
        crossLineEditMode={crossLineEditMode}
        selectedLines={selectedLines}
        setSelectedLines={setSelectedLines}
        setGroups={setGroups}
        selectedCrossLineIndex={selectedCrossLineIndex}
        setSelectedCrossLineIndex={setSelectedCrossLineIndex}
        globalInterval={globalInterval}
        globalLength={globalLength}
        createCrossLineAtPoint={createCrossLineAtPoint}
        updateCrossLineGeometryLocal={updateCrossLineGeometryLocal}
        persistCrossLineGeometry={persistCrossLineGeometry}
        createCrossLineByEndpoints={createCrossLineByEndpoints}
      />
      <EditorSidebar
        uploadedData={uploadedData}
        bankGroups={bankGroups}
        bankList={bankList}
        loadBankById={loadBankById}
        deleteBankById={deleteBankById}
        selectedBankGroup={selectedBankGroup}
        setSelectedBankGroup={setSelectedBankGroup}
        loadBankGroup={loadBankGroup}
        deleteBankGroup={deleteBankGroup}
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
        toggleSelectAllShoreLines={toggleSelectAllShoreLines}
        selectedLinesSize={selectedLines.size}
        handleGenerateSections={handleGenerateSections}
        isFixingShoreLineReversed={isFixingShoreLineReversed}
        toggleFixShoreLineReversed={toggleFixShoreLineReversed}
        sendSelectedShoreLinesGeoJson={sendSelectedShoreLinesGeoJson}
        perpendicularData={perpendicularData}
        setShowGlobalPropertiesModal={setShowGlobalPropertiesModal}
        isSelectingStartEnd={isSelectingStartEnd}
        toggleStartEndSelection={toggleStartEndSelection}
        groups={groups}
        editingGroupId={editingGroupId}
        handleEditGroup={handleEditGroup}
        deleteGroup={deleteGroup}
        updateGroupConfig={updateGroupConfig}
        reverseCrossLinesInGroup={reverseCrossLinesInGroup}
        setEditingPropertiesGroupId={setEditingPropertiesGroupId}
        handleApplyCustomSegments={handleApplyCustomSegments}
        isSelectingCrossLines={isSelectingCrossLines}
        toggleCrossLineSelection={toggleCrossLineSelection}
        validateAllPendingSections={validateAllPendingSections}
        crossLineControlMode={crossLineControlMode}
        setCrossLineControlMode={setCrossLineControlMode}
        crossLineEditMode={crossLineEditMode}
        setCrossLineEditMode={setCrossLineEditMode}
        clearSelectedCrossLineSelection={clearSelectedCrossLineSelection}
        selectedCrossLineIndex={selectedCrossLineIndex}
        translateSelectedCrossLine={translateSelectedCrossLine}
        rotateSelectedCrossLine={rotateSelectedCrossLine}
        scaleSelectedCrossLine={scaleSelectedCrossLine}
        configureSelectedCrossLineProperties={configureSelectedCrossLineProperties}
        deleteSelectedCrossLine={deleteSelectedCrossLine}
        reverseSelectedCrossLine={reverseSelectedCrossLine}
        showCrossLines={showCrossLines}
        setShowCrossLines={setShowCrossLines}
        handleStartAnalysis={handleStartAnalysis}
        onClear={onClear}
        handleFileUpload={handleFileUpload}
        handleSectionsFileUpload={handleSectionsFileUpload}
        onExportSections={handleExportSections}
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
