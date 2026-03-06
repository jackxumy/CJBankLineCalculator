import React, { useState } from 'react';
import type { AnalysisConfig } from '../constants';

export default function PropertiesModal({
  config,
  onSave,
  onClose,
  title
}: {
  config: AnalysisConfig;
  onSave: (newConfig: AnalysisConfig) => void;
  onClose: () => void;
  title: string;
}) {
  const [year, setYear] = useState(config.year);
  const years = Array.from({ length: 17 }, (_, i) => (2010 + i).toString());

  const handleSave = () => {
    onSave({ ...config, year });
    onClose();
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000
    }}>
      <div style={{ backgroundColor: 'white', padding: 20, borderRadius: 8, maxWidth: 600, maxHeight: '80vh', overflow: 'auto' }}>
        <h3 style={{ marginTop: 0 }}>{title}</h3>
        <div style={{ marginBottom: 15 }}>
          <label style={{ display: 'block', marginBottom: 5, fontWeight: 'bold' }}>年份 (year) - 可编辑:</label>
          <select value={year} onChange={(e) => setYear(e.target.value)} style={{ width: '100%', padding: 5 }}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div style={{ marginBottom: 15, opacity: 0.6 }}>
          <label style={{ display: 'block', marginBottom: 5, fontWeight: 'bold' }}>其他属性（仅展示）:</label>
          <pre style={{ backgroundColor: '#f5f5f5', padding: 10, borderRadius: 4, fontSize: 12, maxHeight: 300, overflow: 'auto' }}>
            {JSON.stringify({
              'bench-id': config['bench-id'], 'ref-id': config['ref-id'], 'dem-id': config['dem-id'],
              'current-timepoint': config['current-timepoint'], 'comparison-timepoint': config['comparison-timepoint'],
              segment: config.segment, set: config.set, 'water-qs': config['water-qs'], 'tidal-level': config['tidal-level'],
              hs: config.hs, hc: config.hc, 'protection-level': config['protection-level'], 'control-level': config['control-level'],
              'risk-thresholds': config['risk-thresholds'], wNM: config.wNM, wRE: config.wRE, wGE: config.wGE, wRL: config.wRL
            }, null, 2)}
          </pre>
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '8px 16px' }}>取消</button>
          <button onClick={handleSave} style={{ padding: '8px 16px', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: 4 }}>保存</button>
        </div>
      </div>
    </div>
  );
}
