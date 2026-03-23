import { useState } from 'react';
import type { SectionParams } from '../types/sections';

interface SectionPropertiesModalProps {
  config: SectionParams | null;
  onSave: (newConfig: SectionParams) => void;
  onClose: () => void;
  title: string;
  sectionId?: string;
}

function SectionPropertiesModal({
  config,
  onSave,
  onClose,
  title,
  sectionId
}: SectionPropertiesModalProps) {
  const [params, setParams] = useState<SectionParams>(config || {});
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
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
      }

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
    <div
      style={{
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
      }}
    >
      <div
        style={{
          backgroundColor: 'white',
          padding: '20px',
          borderRadius: '8px',
          maxWidth: '800px',
          maxHeight: '80vh',
          overflow: 'auto',
          boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
        }}
      >
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
                onChange={(e) => setParams({ ...params, param_name: e.target.value })}
                style={{ width: '100%', padding: '5px' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px' }}>河段编码:</label>
              <input
                type="text"
                value={params.segment || ''}
                onChange={(e) => setParams({ ...params, segment: e.target.value })}
                style={{ width: '100%', padding: '5px' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px' }}>当前时间点:</label>
              <input
                type="text"
                value={params.current_timepoint || ''}
                onChange={(e) => setParams({ ...params, current_timepoint: e.target.value })}
                placeholder="YYYY-MM-DD"
                style={{ width: '100%', padding: '5px' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px' }}>对比时间点:</label>
              <input
                type="text"
                value={params.comparison_timepoint || ''}
                onChange={(e) => setParams({ ...params, comparison_timepoint: e.target.value })}
                placeholder="YYYY-MM-DD"
                style={{ width: '100%', padding: '5px' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px' }}>数据集名称:</label>
              <input
                type="text"
                value={params.set_name || ''}
                onChange={(e) => setParams({ ...params, set_name: e.target.value })}
                style={{ width: '100%', padding: '5px' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px' }}>流量:</label>
              <input
                type="text"
                value={params.water_qs || ''}
                onChange={(e) => setParams({ ...params, water_qs: e.target.value })}
                style={{ width: '100%', padding: '5px' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px' }}>潮位:</label>
              <select
                value={params.tidal_level || ''}
                onChange={(e) => setParams({ ...params, tidal_level: e.target.value })}
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
                onChange={(e) => setParams({ ...params, bench_id: e.target.value })}
                style={{ width: '100%', padding: '5px' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px' }}>参考DEM (ref_id):</label>
              <input
                type="text"
                value={params.ref_id || ''}
                onChange={(e) => setParams({ ...params, ref_id: e.target.value })}
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
                value={params.hs ?? ''}
                onChange={(e) => setParams({ ...params, hs: Number(e.target.value) })}
                style={{ width: '100%', padding: '5px' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px' }}>hc:</label>
              <input
                type="number"
                step="0.1"
                value={params.hc ?? ''}
                onChange={(e) => setParams({ ...params, hc: Number(e.target.value) })}
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
                onChange={(e) => setParams({ ...params, protection_level: e.target.value })}
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
                onChange={(e) => setParams({ ...params, control_level: e.target.value })}
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
                setParams({ ...params, risk_thresholds: parsed });
              } catch {
                // ignore parse error while typing
              }
            }}
            rows={8}
            style={{
              width: '100%',
              padding: '5px',
              fontFamily: 'monospace',
              fontSize: '12px'
            }}
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
                setParams({ ...params, weights: parsed });
              } catch {
                // ignore parse error while typing
              }
            }}
            rows={5}
            style={{
              width: '100%',
              padding: '5px',
              fontFamily: 'monospace',
              fontSize: '12px'
            }}
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
}

export default SectionPropertiesModal;
