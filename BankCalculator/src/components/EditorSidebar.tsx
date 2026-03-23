import type { SectionParams } from '../types/sections';

interface SelectionGroup {
  id: string;
  start: number;
  end: number | null;
  interval: number;
  lastAppliedInterval: number;
  length: number;
  crossData: { distance: number; left: number[]; right: number[] }[];
  properties?: SectionParams;
}

interface EditorSidebarProps {
  uploadedData: GeoJSON.FeatureCollection | null;
  basicParamsList: any[];
  selectedBasicParamIdState: string | number | null;
  totalSelectedSegments: number;
  totalCrossLinesCount: number;
  globalInterval: number;
  setGlobalInterval: (v: number) => void;
  globalLength: number;
  setGlobalLength: (v: number) => void;
  isSelectingShoreLines: boolean;
  toggleShoreLineSelection: () => void;
  selectAllShoreLines: () => void;
  selectedLinesSize: number;
  handleGenerateSections: () => void;
  perpendicularData: GeoJSON.FeatureCollection | null;
  setShowGlobalPropertiesModal: (v: boolean) => void;
  isSelectingStartEnd: boolean;
  toggleStartEndSelection: () => void;
  groups: SelectionGroup[];
  editingGroupId: string | null;
  handleEditGroup: (id: string) => void;
  deleteGroup: (id: string) => void;
  updateGroupConfig: (id: string, field: 'interval' | 'length', value: number) => void;
  setEditingPropertiesGroupId: (id: string | null) => void;
  handleApplyCustomSegments: () => void;
  isSelectingCrossLines: boolean;
  toggleCrossLineSelection: () => void;
  crossLineEditMode: 'select' | 'add';
  setCrossLineEditMode: (mode: 'select' | 'add') => void;
  selectedCrossLineIndex: number | null;
  translateSelectedCrossLine: (offset: number) => void;
  configureSelectedCrossLineProperties: () => void;
  deleteSelectedCrossLine: () => void;
  showCrossLines: boolean;
  setShowCrossLines: (v: boolean) => void;
  handleStartAnalysis: () => void;
  onClear: () => void;
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleSelectBasicParam: (id: string | null) => void;
}

function EditorSidebar(props: EditorSidebarProps) {
  const {
    uploadedData,
    basicParamsList,
    selectedBasicParamIdState,
    totalSelectedSegments,
    totalCrossLinesCount,
    globalInterval,
    setGlobalInterval,
    globalLength,
    setGlobalLength,
    isSelectingShoreLines,
    toggleShoreLineSelection,
    selectAllShoreLines,
    selectedLinesSize,
    handleGenerateSections,
    perpendicularData,
    setShowGlobalPropertiesModal,
    isSelectingStartEnd,
    toggleStartEndSelection,
    groups,
    editingGroupId,
    handleEditGroup,
    deleteGroup,
    updateGroupConfig,
    setEditingPropertiesGroupId,
    handleApplyCustomSegments,
    isSelectingCrossLines,
    toggleCrossLineSelection,
    crossLineEditMode,
    setCrossLineEditMode,
    selectedCrossLineIndex,
    translateSelectedCrossLine,
    configureSelectedCrossLineProperties,
    deleteSelectedCrossLine,
    showCrossLines,
    setShowCrossLines,
    handleStartAnalysis,
    onClear,
    handleFileUpload,
    handleSelectBasicParam,
  } = props;

  return (
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
      <div style={{ marginTop: 8 }}>
        <label style={{ fontSize: 12, marginRight: 8 }}>选择参数模板：</label>
        <select
          value={selectedBasicParamIdState ?? ''}
          onChange={(e) => handleSelectBasicParam(e.target.value || null)}
          style={{ padding: '4px 6px', fontSize: 13 }}
        >
          <option value="">（不使用模板）</option>
          {basicParamsList.map((p: any, idx: number) => {
            const paramId = p.param_id ?? p.id ?? idx;
            const name = p.param_name || p.paramName || String(paramId);
            return (
              <option key={String(paramId)} value={String(paramId)}>
                {name}
              </option>
            );
          })}
        </select>
      </div>
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
        <div style={{ marginTop: '10px', marginBottom: '10px' }}>
          <button
            className={`toggle-button ${isSelectingShoreLines ? 'active' : ''}`}
            onClick={toggleShoreLineSelection}
            style={{ marginRight: '5px' }}
          >
            {isPickingShoreLinesLabel(isSelectingShoreLines)}
          </button>
          <button
            className="generate-button"
            onClick={selectAllShoreLines}
            style={{ marginRight: '5px' }}
          >
            ✔️ 全选岸段
          </button>
        </div>
        <p style={{ fontSize: '13px', color: '#64748b', margin: '5px 0' }}>
          已选择 {selectedLinesSize} 个岸段
          {isSelectingShoreLines && ' (点击地图上的线选择/取消选择)'}
        </p>
        <button className="generate-button" onClick={handleGenerateSections}>
          📏 绘制断面
        </button>
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
          style={{ marginBottom: '10px' }}
        >
          {isSelectingStartEnd ? '✅ 起止点选择已开启' : '📍 开启起止点选择'}
        </button>
        <p style={{ fontSize: '13px', color: '#64748b', margin: '5px 0' }}>
          {isSelectingStartEnd
            ? '提示：在地图线上点击两次选择起止点'
            : '点击上方按钮开启起止点选择模式'}
        </p>
      </div>

      {groups.length > 0 && (
        <div className="groups-list">
          <h4>选择组 ({groups.length})</h4>
          {groups.map((g, idx) => (
            <div key={g.id} className={`group-item ${editingGroupId === g.id ? 'editing' : ''}`}>
              <div className="group-header">
                <span>
                  组 {idx + 1}: {g.end === null ? '待选终点' : `已选 (${g.start.toFixed(0)}m - ${g.end.toFixed(0)}m)`}
                </span>
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
                  <button className="apply-button" onClick={handleApplyCustomSegments}>
                    ✅ 应用配置
                  </button>
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
          style={{ marginBottom: '10px' }}
        >
          {isSelectingCrossLines ? '✅ 断面编辑已开启' : '🎯 开启断面编辑'}
        </button>

        {isSelectingCrossLines && (
          <div style={{ marginBottom: '10px', display: 'flex', gap: '5px' }}>
            <button
              className={`toggle-button ${crossLineEditMode === 'select' ? 'active' : ''}`}
              onClick={() => {
                setCrossLineEditMode('select');
                // 选中断面索引由外部重置
              }}
              style={{ flex: 1 }}
            >
              ✏️ 选择断面
            </button>
            <button
              className={`toggle-button ${crossLineEditMode === 'add' ? 'active' : ''}`}
              onClick={() => {
                setCrossLineEditMode('add');
                // 选中断面索引由外部重置
              }}
              style={{ flex: 1 }}
            >
              ➕ 新建断面
            </button>
          </div>
        )}

        {selectedCrossLineIndex !== null && (
          <div
            style={{
              marginBottom: '10px',
              padding: '10px',
              backgroundColor: '#f0f9ff',
              borderRadius: '4px',
            }}
          >
            <p style={{ margin: '0 0 10px 0', fontWeight: 'bold', color: '#0369a1' }}>
              已选中断面 #{selectedCrossLineIndex + 1}
            </p>
            <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
              <button onClick={() => translateSelectedCrossLine(-10)} style={{ padding: '5px 10px', fontSize: '12px' }}>
                ⬅️ -10m
              </button>
              <button onClick={() => translateSelectedCrossLine(-1)} style={{ padding: '5px 10px', fontSize: '12px' }}>
                ⬅️ -1m
              </button>
              <button onClick={() => translateSelectedCrossLine(1)} style={{ padding: '5px 10px', fontSize: '12px' }}>
                ➡️ +1m
              </button>
              <button onClick={() => translateSelectedCrossLine(10)} style={{ padding: '5px 10px', fontSize: '12px' }}>
                ➡️ +10m
              </button>
            </div>
            <div style={{ display: 'flex', gap: '5px', marginTop: '10px' }}>
              <button
                onClick={configureSelectedCrossLineProperties}
                style={{
                  flex: 1,
                  padding: '8px',
                  backgroundColor: '#8b5cf6',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                ⚙️ 属性配置
              </button>
              <button
                onClick={deleteSelectedCrossLine}
                style={{
                  flex: 1,
                  padding: '8px',
                  backgroundColor: '#ef4444',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                🗑️ 删除
              </button>
            </div>
          </div>
        )}
        <p style={{ fontSize: '13px', color: '#64748b', margin: '5px 0' }}>
          {isSelectingCrossLines
            ? crossLineEditMode === 'select'
              ? '💡 点击地图上的断面进行选择'
              : '💡 点击岸段上的点新建断面'
            : '点击上方按钮开启断面编辑模式'}
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
        <p style={{ fontSize: '13px', color: '#64748b', margin: '5px 0' }}>
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
        <button className="clear-button" onClick={onClear}>
          🧹 清空选择
        </button>
      </div>
    </div>
  );
}

function isPickingShoreLinesLabel(isSelecting: boolean) {
  return isSelecting ? '✅ 正在选择岸段' : '🎯 选择岸段';
}

export default EditorSidebar;
