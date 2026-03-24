import { useEffect, useState } from 'react';
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
  deleteSelectedCrossLineAction,
  reverseSelectedCrossLineAction,
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
    
    // 如果当前已经全选了（选中数量等于要素中线段数量），则清空
    const lineFeatures = uploadedData.features.filter(f => 
      f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString'
    );

    if (selectedLines.size === lineFeatures.length && lineFeatures.length > 0) {
      setSelectedLines(new Set());
    } else {
      const allLineIds = new Set<string>();
      lineFeatures.forEach((_, index) => {
        allLineIds.add(`line-${index}`);
      });
      setSelectedLines(allLineIds);
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
        toggleSelectAllShoreLines={toggleSelectAllShoreLines}
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
