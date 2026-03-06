import './HomePage.css';

interface HomePageProps {
  onNavigate: () => void;
}

function HomePage({ onNavigate }: HomePageProps) {
  return (
    <div className="home-page">
      <div className="home-container">
        <div className="home-content">
          <h1 className="home-title">岸线分析系统</h1>
          <p className="home-subtitle">Bank Line Analysis System</p>
          
          <div className="home-features">
            <div className="feature-card">
              <div className="feature-icon">📍</div>
              <h3>岸段选择</h3>
              <p>灵活选择需要分析的岸段区域</p>
            </div>
            
            <div className="feature-card">
              <div className="feature-icon">📏</div>
              <h3>断面生成</h3>
              <p>自动生成垂直于岸线的断面</p>
            </div>
            
            <div className="feature-card">
              <div className="feature-icon">⚙️</div>
              <h3>参数配置</h3>
              <p>自定义间距、长度等分析参数</p>
            </div>
            
            <div className="feature-card">
              <div className="feature-icon">🚀</div>
              <h3>风险分析</h3>
              <p>一键发送数据进行风险评估</p>
            </div>
          </div>

          <button className="start-button" onClick={onNavigate}>
            开始使用
            <span className="button-arrow">→</span>
          </button>

          <div className="home-footer">
            <p>支持 GeoJSON 格式 | 基于 Mapbox GL JS</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default HomePage;
