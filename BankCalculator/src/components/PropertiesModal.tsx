import { useState } from 'react';
import type { AnalysisConfig } from '../constants';
import styles from './Modal.module.css';

export default function PropertiesModal({
  config,
  onSave,
  onClose,
  title,
  sectionId
}: {
  config: AnalysisConfig;
  onSave: (newConfig: AnalysisConfig) => void;
  onClose: () => void;
  title: string;
  sectionId?: string;
}) {
  const [year, setYear] = useState<string>(config.year);
  const years = Array.from({ length: 17 }, (_, i) => (2010 + i).toString());
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const updatedConfig = { ...config, year };
      
      if (sectionId) {
        // 如果有 sectionId，同步到后端断面结果
        const response = await fetch(`/v0/bank/sections/${sectionId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatedConfig)
        });

        if (!response.ok) {
          throw new Error('同步到后端失败');
        }
      }

      onSave(updatedConfig as any);
      onClose();
    } catch (err) {
      alert('保存失败，请重试');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.container}>
        <h3 className={styles.title}>{title}</h3>
        <div className={styles.mb15}>
          <label className={styles.label}>年份 (year) - 可编辑:</label>
          <select value={year} onChange={(e) => setYear(e.target.value)} className={styles.input}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className={`${styles.muted} ${styles.mb15}`}>
          <label className={styles.label}>其他属性（仅展示）:</label>
          <pre className={styles.preBox}>
            {JSON.stringify({
              'bench-id': config['bench-id'], 'ref-id': config['ref-id'], 'dem-id': config['dem-id'],
              'current-timepoint': config['current-timepoint'], 'comparison-timepoint': config['comparison-timepoint'],
              segment: config.segment, set: config.set, 'water-qs': config['water-qs'], 'tidal-level': config['tidal-level'],
              hs: config.hs, hc: config.hc, 'protection-level': config['protection-level'], 'control-level': config['control-level'],
              'risk-thresholds': config['risk-thresholds'], wNM: config.wNM, wRE: config.wRE, wGE: config.wGE, wRL: config.wRL
            }, null, 2)}
          </pre>
        </div>
        <div className={styles.actions}>
          <button onClick={onClose} disabled={isSaving} className={styles.cancelButton}>取消</button>
          <button onClick={handleSave} disabled={isSaving} className={styles.primaryButton}>
            {isSaving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
